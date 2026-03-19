import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@mariozechner/pi-coding-agent";
import { Key, Text } from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskStatus = "pending" | "spawned" | "completed" | "reviewing" | "passed" | "failed" | "crashed" | "corrective" | "merged";

type TaskState = {
	id: string;
	title: string;
	status: TaskStatus;
	pid: number | null;
	pidAlive: boolean | null;
	reviewVerdict: string | null;
	correctiveRound: number;
};

type BuildRunState = {
	runId: string;
	planDir: string;
	baseBranch: string;
	runDir: string;
	worktreeRoot: string;
	tasks: TaskState[];
	modelSpec: string;
	piBin: string;
	startedAt: string;
};

type DerivedRunPhase = "preparing" | "running" | "canceling" | "completed" | "failed" | "canceled";

type BuildEvent = {
	type: string;
	timestamp: string;
	taskId?: string;
	status?: string;
	detail?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_ENTRY = "build-agents-state";
const STATUS_KEY = "build-agents";
const EVENTS_FILE = "events.jsonl";
const BUILD_ROOT = ".pi/build";
const WORKTREE_ROOT_NAME = "worktrees";

const COMMAND_USAGE =
	"/build-agents — multi-agent build orchestration\n/build-agents [start] [plan-dir]\n/build-agents status\n/build-agents cancel\n/build-agents cleanup";

// Auto-resume
const MAX_AUTO_RESUME_TURNS = 5;
const AUTO_RESUME_COOLDOWN_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localIsoDate(now = new Date()): string {
	const yyyy = now.getFullYear();
	const mm = `${now.getMonth() + 1}`.padStart(2, "0");
	const dd = `${now.getDate()}`.padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-")
		.slice(0, 60);
}

function toDisplayPath(targetPath: string, cwd: string): string {
	const resolved = path.resolve(targetPath);
	const fromCwd = path.relative(cwd, resolved);
	if (!fromCwd.startsWith("..") && !path.isAbsolute(fromCwd)) return `./${fromCwd}`;

	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && resolved.startsWith(home)) return `~${resolved.slice(home.length)}`;

	return resolved;
}

/**
 * Resolve the full path to the `pi` binary. Backgrounded subshells from the
 * bash tool lose the parent's PATH, so bare `pi` fails with exit 127. The
 * supervisor prompt must use this absolute path for all `pi -p` invocations.
 */
function resolvePiBinary(): string {
	// First, check if we're running from a known nix store path
	const selfBin = process.argv[0];
	if (selfBin && fs.existsSync(selfBin)) {
		// pi's own binary — resolve to the canonical path
		const dir = path.dirname(selfBin);
		const candidate = path.join(dir, "pi");
		if (fs.existsSync(candidate)) return candidate;
	}

	// Fall back to `which pi`
	try {
		return execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
	} catch {
		return "pi"; // last resort — bare name, may fail in subshells
	}
}

function hasApprovedEntry(changelogPath: string): boolean {
	if (!fs.existsSync(changelogPath) || !fs.statSync(changelogPath).isFile()) return false;
	const content = fs.readFileSync(changelogPath, "utf8");
	return /^\s*-\s*Approved\s+[—-]\s+\d{4}-\d{2}-\d{2},\s+user\./m.test(content);
}

function listApprovedPlanDirs(cwd: string): string[] {
	const plansRoot = path.join(cwd, ".pi", "plans");
	if (!fs.existsSync(plansRoot) || !fs.statSync(plansRoot).isDirectory()) return [];

	return fs
		.readdirSync(plansRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(plansRoot, entry.name))
		.filter((dir) => {
			const changelogPath = path.join(dir, "changelog.md");
			return hasApprovedEntry(changelogPath);
		})
		.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
}

// ---------------------------------------------------------------------------
// Event log helpers
// ---------------------------------------------------------------------------

function readBuildEvents(runDir: string): BuildEvent[] {
	const eventsPath = path.join(runDir, EVENTS_FILE);
	if (!fs.existsSync(eventsPath)) return [];
	try {
		return fs
			.readFileSync(eventsPath, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line) as BuildEvent;
				} catch {
					return null;
				}
			})
			.filter((e): e is BuildEvent => e !== null);
	} catch {
		return [];
	}
}

function appendBuildEvent(runDir: string, event: BuildEvent): void {
	const eventsPath = path.join(runDir, EVENTS_FILE);
	fs.appendFileSync(eventsPath, JSON.stringify(event) + "\n");
}

function deriveRunPhase(events: BuildEvent[], tasks: TaskState[]): DerivedRunPhase {
	// Check events for terminal states
	for (const event of events) {
		if (event.type === "run_canceled") return "canceled";
		if (event.type === "run_completed") return "completed";
		if (event.type === "run_failed") return "failed";
	}

	// Check if canceling is in progress
	for (const event of events) {
		if (event.type === "run_canceling") return "canceling";
	}

	// If no tasks yet, still preparing
	if (tasks.length === 0) return "preparing";

	// Check if all tasks are in terminal states
	const terminalStatuses: TaskStatus[] = ["passed", "failed", "crashed", "merged"];
	const allTerminal = tasks.length > 0 && tasks.every((t) => terminalStatuses.includes(t.status));
	if (allTerminal) {
		const anyFailed = tasks.some((t) => t.status === "failed" || t.status === "crashed");
		return anyFailed ? "failed" : "completed";
	}

	return "running";
}

function isTerminalPhase(phase: DerivedRunPhase): boolean {
	return phase === "completed" || phase === "failed" || phase === "canceled";
}

// ---------------------------------------------------------------------------
// Task artifact scanning
// ---------------------------------------------------------------------------

function scanTaskArtifacts(runDir: string, tasks: TaskState[]): { updated: TaskState[]; newStatuses: Map<string, TaskStatus> } {
	const tasksDir = path.join(runDir, "tasks");
	if (!fs.existsSync(tasksDir)) return { updated: tasks, newStatuses: new Map() };

	const newStatuses = new Map<string, TaskStatus>();
	const taskMap = new Map(tasks.map((t) => [t.id, t]));

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(tasksDir, { withFileTypes: true }).filter((e) => e.isDirectory());
	} catch {
		return { updated: tasks, newStatuses: new Map() };
	}

	for (const entry of entries) {
		const taskId = entry.name;
		const taskDir = path.join(tasksDir, taskId);

		let task = taskMap.get(taskId);
		if (!task) {
			task = {
				id: taskId,
				title: taskId,
				status: "pending",
				pid: null,
				pidAlive: null,
				reviewVerdict: null,
				correctiveRound: 0,
			};
			taskMap.set(taskId, task);
		}

		const oldStatus = task.status;

		// Read PID if present
		const pidFile = path.join(taskDir, "pid");
		if (fs.existsSync(pidFile)) {
			try {
				const pidStr = fs.readFileSync(pidFile, "utf8").trim();
				const pid = parseInt(pidStr, 10);
				if (!isNaN(pid)) task.pid = pid;
			} catch { /* ignore */ }
		}

		// Determine status from artifacts
		const hasResult = fs.existsSync(path.join(taskDir, "RESULT.md"));
		const hasReviewStdout = fs.existsSync(path.join(taskDir, "review-stdout.log"));
		const hasReview = fs.existsSync(path.join(taskDir, "REVIEW.md"));

		if (hasReview) {
			try {
				const reviewContent = fs.readFileSync(path.join(taskDir, "REVIEW.md"), "utf8");
				if (/PASS_WITH_NOTES/i.test(reviewContent) || /^PASS$/im.test(reviewContent)) {
					task.status = "passed";
					task.reviewVerdict = /PASS_WITH_NOTES/i.test(reviewContent) ? "PASS_WITH_NOTES" : "PASS";
				} else if (/FAIL/i.test(reviewContent)) {
					task.status = "failed";
					task.reviewVerdict = "FAIL";
				}
			} catch { /* ignore */ }
		} else if (hasReviewStdout && !hasReview) {
			task.status = "reviewing";
		} else if (hasResult && !hasReviewStdout && !hasReview) {
			task.status = "completed";
		} else if (task.pid !== null && !hasResult) {
			task.status = "spawned";
		}

		if (task.status !== oldStatus) {
			newStatuses.set(taskId, task.status);
		}
	}

	return { updated: Array.from(taskMap.values()), newStatuses };
}

function checkPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Run directory discovery
// ---------------------------------------------------------------------------

function findMostRecentRunDir(cwd: string): string | null {
	const buildRoot = path.join(cwd, BUILD_ROOT);
	if (!fs.existsSync(buildRoot)) return null;

	try {
		const dirs = fs
			.readdirSync(buildRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name !== WORKTREE_ROOT_NAME)
			.map((e) => path.join(buildRoot, e.name))
			.filter((dir) => fs.existsSync(path.join(dir, EVENTS_FILE)))
			.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));

		return dirs[0] ?? null;
	} catch {
		return null;
	}
}

function findActiveRunDirs(cwd: string): string[] {
	const buildRoot = path.join(cwd, BUILD_ROOT);
	if (!fs.existsSync(buildRoot)) return [];

	try {
		return fs
			.readdirSync(buildRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name !== WORKTREE_ROOT_NAME)
			.map((e) => path.join(buildRoot, e.name))
			.filter((dir) => {
				if (!fs.existsSync(path.join(dir, EVENTS_FILE))) return false;
				const events = readBuildEvents(dir);
				const phase = deriveRunPhase(events, []);
				return !isTerminalPhase(phase);
			});
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function buildAgents(pi: ExtensionAPI) {
	let activeRun: BuildRunState | null = null;
	let widgetExpanded = false;
	let lastKnownStatuses = new Map<string, TaskStatus>();

	// Auto-resume tracking
	let turnsThisSession = 0;
	let lastAutoResumeTime = 0;

	function persistState(): void {
		if (activeRun) {
			pi.appendEntry<BuildRunState>(STATE_ENTRY, activeRun);
		}
	}

	function updateWidget(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		if (!activeRun) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.setWidget(STATUS_KEY, undefined);
			return;
		}

		const run = activeRun;
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `🏗️ ${run.runId}`));

		ctx.ui.setWidget(STATUS_KEY, (_tui, theme) => {
			const tasks = run.tasks;
			const events = readBuildEvents(run.runDir);
			const phase = deriveRunPhase(events, tasks);

			const done = tasks.filter((t) => t.status === "passed" || t.status === "merged").length;
			const running = tasks.filter((t) => t.status === "spawned" || t.status === "reviewing" || t.status === "corrective").length;
			const failed = tasks.filter((t) => t.status === "failed").length;
			const crashed = tasks.filter((t) => t.status === "crashed").length;

			if (!widgetExpanded) {
				const parts = [
					theme.fg("accent", `🏗️ ${run.runId}`),
					theme.fg("muted", phase),
					theme.fg("success", `${done}/${tasks.length} done`),
					theme.fg("warning", `${running} running`),
					failed > 0 ? theme.fg("error", `${failed} failed`) : theme.fg("muted", "0 failed"),
					crashed > 0 ? theme.fg("error", `${crashed} crashed`) : theme.fg("muted", "0 crashed"),
					theme.fg("dim", `model: ${run.modelSpec}`),
				];
				return new Text(parts.join(theme.fg("dim", " │ ")), 0, 0);
			}

			// Expanded view
			const lines: string[] = [];
			lines.push(theme.fg("accent", `🏗️ build: ${run.runId}`));
			lines.push(`  Phase: ${phase}`);
			lines.push(`  ${"#".padEnd(4)}${"task".padEnd(20)}${"status".padEnd(14)}${"review".padEnd(10)}${"alive".padEnd(6)}`);

			for (let i = 0; i < tasks.length; i++) {
				const t = tasks[i];
				const num = String(i + 1).padEnd(4);
				const name = t.id.slice(0, 18).padEnd(20);

				let statusIcon: string;
				switch (t.status) {
					case "passed":
					case "merged":
						statusIcon = theme.fg("success", `✓ ${t.status}`.padEnd(14));
						break;
					case "failed":
					case "crashed":
						statusIcon = theme.fg("error", `✗ ${t.status}`.padEnd(14));
						break;
					case "spawned":
					case "reviewing":
					case "corrective":
						statusIcon = theme.fg("warning", `⏳ ${t.status}`.padEnd(14));
						break;
					default:
						statusIcon = theme.fg("muted", `· ${t.status}`.padEnd(14));
				}

				const review = (t.reviewVerdict ?? "—").padEnd(10);
				let alive: string;
				if (t.pidAlive === true) alive = theme.fg("success", "✓");
				else if (t.pidAlive === false) alive = theme.fg("error", "✗");
				else alive = "—";

				lines.push(`  ${num}${name}${statusIcon}${review}${alive}`);
			}

			return new Text(lines.join("\n"), 0, 0);
		});
	}

	// ------------------------------------------------------------------
	// Command: /build-agents
	// ------------------------------------------------------------------

	async function handleStart(args: string, ctx: ExtensionContext): Promise<void> {
		// 1. Concurrent run guard
		const activeRunDirs = findActiveRunDirs(ctx.cwd);
		if (activeRunDirs.length > 0) {
			const proceed = await ctx.ui.confirm(
				`Active build run found (${activeRunDirs.map((d) => path.basename(d)).join(", ")}). Cancel and start new?`,
			);
			if (!proceed) {
				ctx.ui.notify("Aborted. Existing run is still active.", "info");
				return;
			}
			// Cancel existing runs
			for (const runDir of activeRunDirs) {
				appendBuildEvent(runDir, {
					type: "run_canceled",
					timestamp: new Date().toISOString(),
					detail: "Canceled for new run",
				});
			}
		}

		// 2. Plan mode gate — ensure we're NOT in plan mode (bash and write must be available)
		const activeTools = pi.getActiveTools();
		if (!activeTools.includes("bash") || !activeTools.includes("write")) {
			ctx.ui.notify(
				"Build requires full tool access. Run /plan off first to disable plan mode.",
				"warning",
			);
			return;
		}

		// 3. Validate clean git
		const diffResult = await pi.exec("git", ["diff", "--quiet"]);
		const diffCachedResult = await pi.exec("git", ["diff", "--cached", "--quiet"]);
		if (diffResult.code !== 0 || diffCachedResult.code !== 0) {
			ctx.ui.notify("Working tree has uncommitted changes. Commit or stash before starting a build.", "warning");
			return;
		}

		// 4. Find approved plan
		let planDir: string | null = null;
		if (args.trim()) {
			const inputDir = path.resolve(ctx.cwd, args.trim());
			if (fs.existsSync(inputDir) && fs.statSync(inputDir).isDirectory()) {
				planDir = inputDir;
			} else {
				ctx.ui.notify(`Plan directory not found: ${toDisplayPath(inputDir, ctx.cwd)}`, "error");
				return;
			}
		} else {
			const approved = listApprovedPlanDirs(ctx.cwd);
			if (approved.length === 0) {
				ctx.ui.notify("No approved plans found in .pi/plans/. Create and approve a plan first.", "warning");
				return;
			}

			const labels = approved.map((dir) => toDisplayPath(dir, ctx.cwd));
			const choice = await ctx.ui.select("Select plan:", labels);
			if (!choice) return;

			const selectedIndex = labels.indexOf(choice);
			if (selectedIndex < 0) return;
			planDir = approved[selectedIndex] ?? null;
		}

		if (!planDir) return;

		// Verify approval
		const changelogPath = path.join(planDir, "changelog.md");
		if (!hasApprovedEntry(changelogPath)) {
			ctx.ui.notify(`Plan not approved: ${toDisplayPath(planDir, ctx.cwd)}`, "warning");
			return;
		}

		// 5. Model picker
		let models: string[] = [];
		try {
			const settingsPath = path.join(getAgentDir(), "settings.json");
			if (fs.existsSync(settingsPath)) {
				const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
				if (Array.isArray(settings.enabledModels) && settings.enabledModels.length > 0) {
					models = settings.enabledModels;
				}
			}
		} catch { /* ignore */ }
		if (models.length === 0) {
			models = ["current session model"];
		}

		const selectedModel = await ctx.ui.select("Model for subprocesses:", models);
		if (!selectedModel) return;

		// 6. Thinking level picker
		const thinkingLevels = ["medium", "low", "high"];
		const selectedThinking = await ctx.ui.select("Thinking level:", thinkingLevels);
		if (!selectedThinking) return;

		// 7. Combine into modelSpec
		const modelSpec = `${selectedModel}:${selectedThinking}`;

		// 8. Create run directory
		const planSlug = slugify(path.basename(planDir));
		const runId = `${localIsoDate()}-${planSlug}`;
		const runDir = path.join(ctx.cwd, BUILD_ROOT, runId);
		const tasksDir = path.join(runDir, "tasks");
		fs.mkdirSync(tasksDir, { recursive: true });

		// 9. Create worktree root
		const worktreeRoot = path.join(ctx.cwd, BUILD_ROOT, WORKTREE_ROOT_NAME);
		fs.mkdirSync(worktreeRoot, { recursive: true });

		// Get base branch
		const branchResult = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
		const baseBranch = (branchResult.stdout || "main").trim();

		// 10. Write initial events.jsonl
		appendBuildEvent(runDir, {
			type: "run_started",
			timestamp: new Date().toISOString(),
			detail: `Plan: ${planDir}, Model: ${modelSpec}`,
		});

		// 11. Resolve pi binary path (backgrounded subshells lose PATH)
		const piBin = resolvePiBinary();

		// 12. Persist BuildRunState
		activeRun = {
			runId,
			planDir,
			baseBranch,
			runDir,
			worktreeRoot,
			tasks: [],
			modelSpec,
			piBin,
			startedAt: new Date().toISOString(),
		};
		persistState();

		// Update widget
		updateWidget(ctx);
		turnsThisSession = 0;

		// 13. Send kickoff message
		const kickoffMsg = [
			`Multi-agent build started.`,
			`Run ID: ${runId}`,
			`Run directory: ${runDir}`,
			`Plan directory: ${planDir}`,
			`Worktree root: ${worktreeRoot}`,
			`Base branch: ${baseBranch}`,
			`Model spec: ${modelSpec}`,
			`Pi binary: ${piBin}`,
			``,
			`Read the plan at ${path.join(planDir, "plan.md")} and begin orchestrating the multi-agent build.`,
			`Create task subdirectories under ${tasksDir}/ for each implementation task.`,
			`**IMPORTANT:** Use \`"${piBin}"\` (not bare \`pi\`) in all \`pi -p\` commands — backgrounded subshells lose PATH.`,
			`Add \`--model ${modelSpec}\` to every subprocess.`,
		].join("\n");

		pi.sendUserMessage(kickoffMsg);
		ctx.ui.notify(`Build started: ${runId}`, "info");
	}

	async function handleStatus(ctx: ExtensionContext): Promise<void> {
		if (!activeRun) {
			// Try to find most recent run
			const recentRunDir = findMostRecentRunDir(ctx.cwd);
			if (!recentRunDir) {
				ctx.ui.notify("No build runs found.", "info");
				return;
			}

			const events = readBuildEvents(recentRunDir);
			const phase = deriveRunPhase(events, []);
			ctx.ui.notify(
				`Last run: ${path.basename(recentRunDir)}\nPhase: ${phase}\nDir: ${toDisplayPath(recentRunDir, ctx.cwd)}`,
				"info",
			);
			return;
		}

		const run = activeRun;
		const events = readBuildEvents(run.runDir);
		const phase = deriveRunPhase(events, run.tasks);
		const done = run.tasks.filter((t) => t.status === "passed" || t.status === "merged").length;
		const running = run.tasks.filter((t) => t.status === "spawned" || t.status === "reviewing" || t.status === "corrective").length;
		const failed = run.tasks.filter((t) => t.status === "failed").length;
		const crashed = run.tasks.filter((t) => t.status === "crashed").length;

		const lines = [
			`Run: ${run.runId}`,
			`Phase: ${phase}`,
			`Plan: ${toDisplayPath(run.planDir, ctx.cwd)}`,
			`Model: ${run.modelSpec}`,
			`Tasks: ${run.tasks.length} total, ${done} done, ${running} running, ${failed} failed, ${crashed} crashed`,
			`Started: ${run.startedAt}`,
		];

		for (const task of run.tasks) {
			lines.push(`  ${task.id}: ${task.status}${task.reviewVerdict ? ` (${task.reviewVerdict})` : ""}${task.pidAlive === false ? " [dead]" : ""}`);
		}

		ctx.ui.notify(lines.join("\n"), "info");
	}

	async function handleCancel(ctx: ExtensionContext): Promise<void> {
		if (!activeRun) {
			ctx.ui.notify("No active build run to cancel.", "warning");
			return;
		}

		const run = activeRun;
		const tasksDir = path.join(run.runDir, "tasks");

		// Kill task processes
		if (fs.existsSync(tasksDir)) {
			try {
				const taskDirs = fs.readdirSync(tasksDir, { withFileTypes: true }).filter((e) => e.isDirectory());
				for (const taskEntry of taskDirs) {
					const pidFile = path.join(tasksDir, taskEntry.name, "pid");
					if (fs.existsSync(pidFile)) {
						try {
							const pid = fs.readFileSync(pidFile, "utf8").trim();
							await pi.exec("kill", [pid]);
						} catch { /* ignore */ }
					}
				}
			} catch { /* ignore */ }
		}

		// Append cancel event
		appendBuildEvent(run.runDir, {
			type: "run_canceled",
			timestamp: new Date().toISOString(),
			detail: "Canceled by user",
		});

		// Clean up worktrees
		if (fs.existsSync(run.worktreeRoot)) {
			try {
				const worktrees = fs.readdirSync(run.worktreeRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
				for (const wt of worktrees) {
					const wtPath = path.join(run.worktreeRoot, wt.name);
					await pi.exec("git", ["worktree", "remove", "--force", wtPath]);
				}
			} catch { /* ignore */ }
		}

		ctx.ui.notify(`Build run ${run.runId} canceled.`, "info");
		activeRun = null;
		updateWidget(ctx);
	}

	async function handleCleanup(ctx: ExtensionContext): Promise<void> {
		const worktreeRoot = path.join(ctx.cwd, BUILD_ROOT, WORKTREE_ROOT_NAME);
		let cleaned = 0;

		// Clean orphaned worktrees
		if (fs.existsSync(worktreeRoot)) {
			try {
				const worktrees = fs.readdirSync(worktreeRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
				for (const wt of worktrees) {
					const wtPath = path.join(worktreeRoot, wt.name);
					const result = await pi.exec("git", ["worktree", "remove", "--force", wtPath]);
					if (result.code === 0) cleaned++;
				}
			} catch { /* ignore */ }
		}

		// Clean orphaned build/* branches
		const branchResult = await pi.exec("git", ["branch", "--list", "build/*"]);
		if (branchResult.code === 0 && branchResult.stdout.trim()) {
			const branches = branchResult.stdout
				.split("\n")
				.map((b) => b.trim().replace(/^\*\s*/, ""))
				.filter(Boolean);
			for (const branch of branches) {
				const delResult = await pi.exec("git", ["branch", "-D", branch]);
				if (delResult.code === 0) cleaned++;
			}
		}

		ctx.ui.notify(`Cleanup complete. Removed ${cleaned} orphaned worktrees/branches.`, "info");
	}

	pi.registerCommand("build-agents", {
		description: "Multi-agent build orchestration. Subcommands: start/status/cancel/cleanup",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const [verb, ...restParts] = trimmed.split(/\s+/);
			const rest = restParts.join(" ").trim();

			if (!verb || verb === "start") {
				await handleStart(rest, ctx);
				return;
			}

			if (verb === "status") {
				await handleStatus(ctx);
				return;
			}

			if (verb === "cancel") {
				await handleCancel(ctx);
				return;
			}

			if (verb === "cleanup") {
				await handleCleanup(ctx);
				return;
			}

			ctx.ui.notify(COMMAND_USAGE, "warning");
		},
	});

	// ------------------------------------------------------------------
	// Ctrl+Shift+B — toggle expanded widget
	// ------------------------------------------------------------------

	pi.registerShortcut(Key.ctrlShift("b"), {
		description: "Toggle build-agents widget expanded/collapsed",
		handler: async (ctx) => {
			widgetExpanded = !widgetExpanded;
			updateWidget(ctx);
		},
	});

	// ------------------------------------------------------------------
	// System prompt injection (before_agent_start)
	// ------------------------------------------------------------------

	pi.on("before_agent_start", async (event, ctx) => {
		if (!activeRun) return;

		turnsThisSession++;

		const promptPath = path.join(getAgentDir(), "extensions", "build-agents-prompt.md");
		if (!fs.existsSync(promptPath)) {
			ctx.ui.notify(
				`⚠️ build-agents-prompt.md not found at ${promptPath}. Run \`make install\` to set up prompts.`,
				"warning",
			);
			return;
		}

		let promptContent: string;
		try {
			promptContent = fs.readFileSync(promptPath, "utf8");
		} catch {
			return;
		}

		const run = activeRun;
		const runContext = [
			"## Run Context (injected by extension — do not edit)",
			"",
			`RUN_ID: ${run.runId}`,
			`RUN_DIR: ${run.runDir}`,
			`WORKTREE_ROOT: ${run.worktreeRoot}`,
			`BASE_BRANCH: ${run.baseBranch}`,
			`PLAN_DIR: ${run.planDir}`,
			`MODEL_SPEC: ${run.modelSpec}`,
			`PI_BIN: ${run.piBin}`,
			"",
			"**CRITICAL — use full pi path in subshells:**",
			"Backgrounded subshells (`&`) from bash tool calls lose the parent PATH.",
			`Always use \`"${run.piBin}"\` instead of bare \`pi\` in all \`pi -p\` commands.`,
			"",
			"Correct pattern:",
			"```bash",
			`( cd "$WORKTREE_DIR" && "${run.piBin}" -p --no-session --no-skills --model ${run.modelSpec} \\`,
			`    --append-system-prompt "$PROMPT_FILE" \\`,
			`    "..." \\`,
			`) > "$LOG_FILE" 2>&1 &`,
			"```",
			"",
			`Add \`--model ${run.modelSpec}\` to every \`pi -p\` command you spawn.`,
			"This applies to both implementer and reviewer subprocesses.",
		].join("\n");

		return {
			systemPrompt: event.systemPrompt + "\n\n" + promptContent + "\n\n" + runContext,
		};
	});

	// ------------------------------------------------------------------
	// tool_result hook — artifact scanning + PID health
	// ------------------------------------------------------------------

	pi.on("tool_result", async (_event, ctx) => {
		if (!activeRun) return;

		const run = activeRun;

		// Scan task artifacts
		const { updated, newStatuses } = scanTaskArtifacts(run.runDir, run.tasks);
		run.tasks = updated;

		// Emit events for new status transitions
		for (const [taskId, newStatus] of newStatuses) {
			const lastKnown = lastKnownStatuses.get(taskId);
			if (lastKnown !== newStatus) {
				appendBuildEvent(run.runDir, {
					type: `task_${newStatus}`,
					timestamp: new Date().toISOString(),
					taskId,
					status: newStatus,
				});
				lastKnownStatuses.set(taskId, newStatus);
			}
		}

		// PID health monitoring
		for (const task of run.tasks) {
			if (task.status === "spawned" && task.pid !== null) {
				const alive = checkPidAlive(task.pid);
				task.pidAlive = alive;

				if (!alive) {
					const taskDir = path.join(run.runDir, "tasks", task.id);
					const hasResult = fs.existsSync(path.join(taskDir, "RESULT.md"));
					if (!hasResult) {
						task.status = "crashed";
						task.pidAlive = false;
						appendBuildEvent(run.runDir, {
							type: "task_crashed",
							timestamp: new Date().toISOString(),
							taskId: task.id,
							status: "crashed",
							detail: `PID ${task.pid} died without producing RESULT.md`,
						});
						lastKnownStatuses.set(task.id, "crashed");
						ctx.ui.notify(`💥 Task ${task.id} crashed (PID ${task.pid} died)`, "error");
					}
				}
			}
		}

		persistState();
		updateWidget(ctx);
	});

	// ------------------------------------------------------------------
	// Auto-resume on agent_end
	// ------------------------------------------------------------------

	pi.on("agent_end", async (_event, ctx) => {
		if (!activeRun) return;
		if (turnsThisSession === 0) return;

		const events = readBuildEvents(activeRun.runDir);
		const phase = deriveRunPhase(events, activeRun.tasks);
		if (isTerminalPhase(phase)) return;

		// Rate-limit
		const now = Date.now();
		if (now - lastAutoResumeTime < AUTO_RESUME_COOLDOWN_MS) return;
		if (turnsThisSession >= MAX_AUTO_RESUME_TURNS) {
			ctx.ui.notify(
				`Build auto-resume limit reached (${MAX_AUTO_RESUME_TURNS} turns). Use /build-agents to re-activate.`,
				"info",
			);
			return;
		}

		lastAutoResumeTime = now;

		const run = activeRun;
		let resumeMsg = `Build context limit reached. Resume orchestrating the multi-agent build.`;
		resumeMsg += ` Run dir: ${run.runDir}. Plan: ${run.planDir}.`;
		resumeMsg += ` Check task status in ${path.join(run.runDir, "tasks")}/ and continue the build workflow.`;

		pi.sendUserMessage(resumeMsg);
	});

	// ------------------------------------------------------------------
	// Session start — run discovery
	// ------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		// Restore from appendEntry snapshots
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;
			if (entry.customType !== STATE_ENTRY) continue;
			const data = entry.data as Partial<BuildRunState> | undefined;
			if (!data || !data.runId) continue;

			activeRun = {
				runId: data.runId,
				planDir: data.planDir ?? "",
				baseBranch: data.baseBranch ?? "main",
				runDir: data.runDir ?? "",
				worktreeRoot: data.worktreeRoot ?? "",
				tasks: Array.isArray(data.tasks) ? data.tasks : [],
				modelSpec: data.modelSpec ?? "",
				piBin: typeof data.piBin === "string" && data.piBin ? data.piBin : resolvePiBinary(),
				startedAt: data.startedAt ?? "",
			};
		}

		// Also scan filesystem for most recent run
		const recentRunDir = findMostRecentRunDir(ctx.cwd);
		if (recentRunDir) {
			const events = readBuildEvents(recentRunDir);
			const phase = deriveRunPhase(events, activeRun?.tasks ?? []);

			if (!isTerminalPhase(phase)) {
				// Re-enable widget for active run
				if (!activeRun || activeRun.runDir !== recentRunDir) {
					// Reconstruct minimal state from filesystem
					activeRun = activeRun ?? {
						runId: path.basename(recentRunDir),
						planDir: "",
						baseBranch: "main",
						runDir: recentRunDir,
						worktreeRoot: path.join(path.dirname(recentRunDir), WORKTREE_ROOT_NAME),
						tasks: [],
						modelSpec: "",
						piBin: resolvePiBinary(),
						startedAt: "",
					};

					// Extract info from run_started event if available
					const startEvent = events.find((e) => e.type === "run_started");
					if (startEvent?.detail) {
						const planMatch = startEvent.detail.match(/Plan:\s*(.+?),/);
						const modelMatch = startEvent.detail.match(/Model:\s*(.+)/);
						if (planMatch) activeRun.planDir = planMatch[1].trim();
						if (modelMatch) activeRun.modelSpec = modelMatch[1].trim();
					}
				}

				// Scan artifacts to rebuild task state
				const { updated } = scanTaskArtifacts(activeRun.runDir, activeRun.tasks);
				activeRun.tasks = updated;

				// Rebuild lastKnownStatuses
				for (const task of activeRun.tasks) {
					lastKnownStatuses.set(task.id, task.status);
				}

				ctx.ui.notify(`Active build run found: ${activeRun.runId}`, "info");
			}
		}

		updateWidget(ctx);
	});
}
