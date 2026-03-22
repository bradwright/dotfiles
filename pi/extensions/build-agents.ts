import * as fs from "node:fs";
import * as path from "node:path";

import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@mariozechner/pi-coding-agent";
import { Key, Text } from "@mariozechner/pi-tui";
import {
	localIsoDate,
	slugify,
	toDisplayPath,
	hasApprovedEntry,
	listApprovedPlanDirs,
	readJsonlEvents,
	appendJsonlEvent,
} from "./shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskStatus = "pending" | "spawned" | "completed" | "reviewing" | "passed" | "failed" | "crashed" | "corrective" | "merged";

type TaskState = {
	id: string;
	title: string;
	status: TaskStatus;
	reviewVerdict: string | null;
	correctiveRound: number;
};

type PlanSource =
	| { type: "file"; path: string }      // a specific file (plan.md, etc.)
	| { type: "dir"; path: string }        // a plan directory (approved /plan output)
	| { type: "inline"; text: string };    // text passed directly as args

type BuildRunState = {
	runId: string;
	planSource: PlanSource;
	baseBranch: string;
	runDir: string;
	worktreeRoot: string;
	tasks: TaskState[];
	modelOverride: string | null; // null = use per-agent defaults from .pi/agents/
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
	"/build-agents — multi-agent build orchestration\n/build-agents [start] [plan-file|plan-dir|description]\n/build-agents status\n/build-agents cancel\n/build-agents cleanup";

// Auto-resume
const MAX_AUTO_RESUME_TURNS = 5;
const AUTO_RESUME_COOLDOWN_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function planSourceLabel(source: PlanSource, cwd: string): string {
	switch (source.type) {
		case "file": return toDisplayPath(source.path, cwd);
		case "dir": return toDisplayPath(source.path, cwd);
		case "inline": return `"${source.text.slice(0, 60)}${source.text.length > 60 ? "…" : ""}"`;
	}
}

function planSourceForKickoff(source: PlanSource): string {
	switch (source.type) {
		case "file": return `Read the plan at ${source.path} and begin orchestrating the multi-agent build.`;
		case "dir": return `Read the plan at ${path.join(source.path, "plan.md")} and begin orchestrating the multi-agent build.`;
		case "inline": return `The build goal is:\n\n${source.text}\n\nBegin orchestrating the multi-agent build.`;
	}
}

function planSourceSlug(source: PlanSource): string {
	switch (source.type) {
		case "file": return slugify(path.basename(source.path, path.extname(source.path)));
		case "dir": return slugify(path.basename(source.path));
		case "inline": return slugify(source.text.slice(0, 40));
	}
}

// ---------------------------------------------------------------------------
// Event log helpers
// ---------------------------------------------------------------------------

function deriveRunPhase(events: BuildEvent[], tasks: TaskState[]): DerivedRunPhase {
	for (const event of events) {
		if (event.type === "run_canceled") return "canceled";
		if (event.type === "run_completed") return "completed";
		if (event.type === "run_failed") return "failed";
	}

	for (const event of events) {
		if (event.type === "run_canceling") return "canceling";
	}

	if (tasks.length === 0) return "preparing";

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
// Task artifact scanning (file-based status detection)
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
				reviewVerdict: null,
				correctiveRound: 0,
			};
			taskMap.set(taskId, task);
		}

		const oldStatus = task.status;

		// Determine status from artifacts
		const hasResult = fs.existsSync(path.join(taskDir, "RESULT.md"));
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
		} else if (hasResult) {
			task.status = "completed";
		}

		if (task.status !== oldStatus) {
			newStatuses.set(taskId, task.status);
		}
	}

	return { updated: Array.from(taskMap.values()), newStatuses };
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
				const events = readJsonlEvents<BuildEvent>(path.join(dir, EVENTS_FILE));
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
			const events = readJsonlEvents<BuildEvent>(path.join(run.runDir, EVENTS_FILE));
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
					theme.fg("dim", `model: ${run.modelOverride ?? "agent defaults"}`),
				];
				return new Text(parts.join(theme.fg("dim", " │ ")), 0, 0);
			}

			// Expanded view
			const lines: string[] = [];
			lines.push(theme.fg("accent", `🏗️ build: ${run.runId}`));
			lines.push(`  Phase: ${phase}`);
			lines.push(`  ${"#".padEnd(4)}${"task".padEnd(20)}${"status".padEnd(14)}${"review".padEnd(10)}`);

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
				lines.push(`  ${num}${name}${statusIcon}${review}`);
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
			for (const runDir of activeRunDirs) {
				appendJsonlEvent(path.join(runDir, EVENTS_FILE), {
					type: "run_canceled",
					timestamp: new Date().toISOString(),
					detail: "Canceled for new run",
				});
			}
		}

		// 2. Plan mode gate
		const activeTools = pi.getActiveTools();
		if (!activeTools.includes("bash") || !activeTools.includes("write")) {
			ctx.ui.notify(
				"Build requires full tool access. Run /plan off first to disable plan mode.",
				"warning",
			);
			return;
		}

		// 3. Verify subagent tool is available
		if (!activeTools.includes("subagent")) {
			ctx.ui.notify(
				"Build requires the subagent tool (pi-subagents extension). Install with: pi install npm:pi-subagents",
				"warning",
			);
			return;
		}

		// 4. Validate clean git
		const diffResult = await pi.exec("git", ["diff", "--quiet"]);
		const diffCachedResult = await pi.exec("git", ["diff", "--cached", "--quiet"]);
		if (diffResult.code !== 0 || diffCachedResult.code !== 0) {
			ctx.ui.notify("Working tree has uncommitted changes. Commit or stash before starting a build.", "warning");
			return;
		}

		// 5. Resolve plan source — file, directory, inline text, or interactive picker
		let planSource: PlanSource | null = null;

		if (args.trim()) {
			const resolved = path.resolve(ctx.cwd, args.trim());

			if (fs.existsSync(resolved)) {
				const stat = fs.statSync(resolved);
				if (stat.isFile()) {
					planSource = { type: "file", path: resolved };
				} else if (stat.isDirectory()) {
					planSource = { type: "dir", path: resolved };
				}
			}

			// If it didn't resolve to a file/dir, treat as inline text
			if (!planSource) {
				planSource = { type: "inline", text: args.trim() };
			}
		} else {
			// Interactive picker: approved plans + ad-hoc option
			const approved = listApprovedPlanDirs(ctx.cwd);
			const INLINE_LABEL = "⌨ Describe what to build (inline)";
			const labels = [
				...approved.map((dir) => toDisplayPath(dir, ctx.cwd)),
				INLINE_LABEL,
			];

			const choice = await ctx.ui.select("Plan source:", labels);
			if (!choice) return;

			if (choice === INLINE_LABEL) {
				const text = await ctx.ui.prompt("What should be built?");
				if (!text?.trim()) return;
				planSource = { type: "inline", text: text.trim() };
			} else {
				const selectedIndex = labels.indexOf(choice);
				if (selectedIndex < 0 || !approved[selectedIndex]) return;
				planSource = { type: "dir", path: approved[selectedIndex] };
			}
		}

		if (!planSource) return;

		// 6. Model override picker
		// Agent definitions in .pi/agents/ have per-role defaults:
		//   implementer: claude-sonnet-4-6:medium  (code generation)
		//   reviewer:    claude-sonnet-4-6:high     (deep analysis)
		//   merger:      claude-sonnet-4-6:low      (mechanical git ops)
		// The user can override all agents to a single model, or use defaults.
		const AGENT_DEFAULTS_LABEL = "Use agent defaults (recommended)";
		let modelChoices: string[] = [AGENT_DEFAULTS_LABEL];
		try {
			const settingsPath = path.join(getAgentDir(), "settings.json");
			if (fs.existsSync(settingsPath)) {
				const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
				if (Array.isArray(settings.enabledModels) && settings.enabledModels.length > 0) {
					modelChoices = modelChoices.concat(settings.enabledModels);
				}
			}
		} catch { /* ignore */ }

		const selectedModel = await ctx.ui.select("Model for subagents:", modelChoices);
		if (!selectedModel) return;

		let modelOverride: string | null = null;
		if (selectedModel !== AGENT_DEFAULTS_LABEL) {
			// When overriding, pick a thinking level for the override
			const thinkingLevels = ["medium", "low", "high"];
			const selectedThinking = await ctx.ui.select("Thinking level (for override):", thinkingLevels);
			if (!selectedThinking) return;
			modelOverride = `${selectedModel}:${selectedThinking}`;
		}

		// 9. Create run directory
		const planSlug = planSourceSlug(planSource);
		const runId = `${localIsoDate()}-${planSlug}`;
		const runDir = path.join(ctx.cwd, BUILD_ROOT, runId);
		const tasksDir = path.join(runDir, "tasks");
		fs.mkdirSync(tasksDir, { recursive: true });

		// 10. Create worktree root
		const worktreeRoot = path.join(ctx.cwd, BUILD_ROOT, WORKTREE_ROOT_NAME);
		fs.mkdirSync(worktreeRoot, { recursive: true });

		// Get base branch
		const branchResult = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
		const baseBranch = (branchResult.stdout || "main").trim();

		// 11. Write initial event
		appendJsonlEvent(path.join(runDir, EVENTS_FILE), {
			type: "run_started",
			timestamp: new Date().toISOString(),
			detail: `Plan: ${planSourceLabel(planSource, ctx.cwd)}, Model: ${modelOverride ?? "agent-defaults"}`,
		});

		// 12. Persist BuildRunState
		activeRun = {
			runId,
			planSource,
			baseBranch,
			runDir,
			worktreeRoot,
			tasks: [],
			modelOverride,
			startedAt: new Date().toISOString(),
		};
		persistState();

		// Update widget
		updateWidget(ctx);
		turnsThisSession = 0;

		// 13. Send kickoff message
		const modelLine = modelOverride
			? `Model override: ${modelOverride} (applies to all agents)`
			: `Model: per-agent defaults (planner=sonnet:high, implementer=sonnet:medium, reviewer=codex:medium, merger=sonnet:low)`;

		const kickoffMsg = [
			`Multi-agent build started.`,
			`Run ID: ${runId}`,
			`Run directory: ${runDir}`,
			`Plan source: ${planSourceLabel(planSource, ctx.cwd)}`,
			`Worktree root: ${worktreeRoot}`,
			`Base branch: ${baseBranch}`,
			modelLine,
			``,
			planSourceForKickoff(planSource),
			`Create task subdirectories under ${tasksDir}/ for each implementation task.`,
			``,
			`Use the \`subagent\` tool for all subprocess work:`,
			`- Task decomposition: use single mode with the \`build-planner\` agent`,
			`- Parallel implementers: use parallel mode with \`cwd\` set to each worktree`,
			`- Reviews: use single mode with the \`reviewer\` agent`,
			`- Merge: use single mode with the \`merger\` agent`,
			``,
			...(modelOverride
				? [`Pass \`model: "${modelOverride}"\` in each subagent task item to override agent defaults.`]
				: [`Do NOT pass a \`model\` field in subagent task items — let each agent use its own default model and thinking level.`]),
		].join("\n");

		pi.sendUserMessage(kickoffMsg);
		ctx.ui.notify(`Build started: ${runId}`, "info");
	}

	async function handleStatus(ctx: ExtensionContext): Promise<void> {
		if (!activeRun) {
			const recentRunDir = findMostRecentRunDir(ctx.cwd);
			if (!recentRunDir) {
				ctx.ui.notify("No build runs found.", "info");
				return;
			}

			const events = readJsonlEvents<BuildEvent>(path.join(recentRunDir, EVENTS_FILE));
			const phase = deriveRunPhase(events, []);
			ctx.ui.notify(
				`Last run: ${path.basename(recentRunDir)}\nPhase: ${phase}\nDir: ${toDisplayPath(recentRunDir, ctx.cwd)}`,
				"info",
			);
			return;
		}

		const run = activeRun;
		const events = readJsonlEvents<BuildEvent>(path.join(run.runDir, EVENTS_FILE));
		const phase = deriveRunPhase(events, run.tasks);
		const done = run.tasks.filter((t) => t.status === "passed" || t.status === "merged").length;
		const running = run.tasks.filter((t) => t.status === "spawned" || t.status === "reviewing" || t.status === "corrective").length;
		const failed = run.tasks.filter((t) => t.status === "failed").length;
		const crashed = run.tasks.filter((t) => t.status === "crashed").length;

		const lines = [
			`Run: ${run.runId}`,
			`Phase: ${phase}`,
			`Plan: ${planSourceLabel(run.planSource, ctx.cwd)}`,
			`Model: ${run.modelOverride ?? "agent defaults"}`,
			`Tasks: ${run.tasks.length} total, ${done} done, ${running} running, ${failed} failed, ${crashed} crashed`,
			`Started: ${run.startedAt}`,
		];

		for (const task of run.tasks) {
			lines.push(`  ${task.id}: ${task.status}${task.reviewVerdict ? ` (${task.reviewVerdict})` : ""}`);
		}

		ctx.ui.notify(lines.join("\n"), "info");
	}

	async function handleCancel(ctx: ExtensionContext): Promise<void> {
		if (!activeRun) {
			ctx.ui.notify("No active build run to cancel.", "warning");
			return;
		}

		const run = activeRun;

		// Append cancel event
		appendJsonlEvent(path.join(run.runDir, EVENTS_FILE), {
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
		const modelInstructions = run.modelOverride
			? [
				`MODEL_OVERRIDE: ${run.modelOverride}`,
				"",
				"A model override is active. Pass `model: \"" + run.modelOverride + "\"` in each subagent task item.",
			]
			: [
				"MODEL_OVERRIDE: none (using per-agent defaults)",
				"",
				"Per-agent defaults are active:",
				"  build-planner: claude-sonnet-4-6:high   (task decomposition — dependency analysis)",
				"  implementer:   claude-sonnet-4-6:medium (code generation — speed + volume)",
				"  reviewer:      gpt-5.3-codex:medium     (code-native review — spotting issues)",
				"  merger:        claude-sonnet-4-6:low    (mechanical git ops — fast + cheap)",
				"",
				"Do NOT pass a `model` field in subagent task items — let agent frontmatter defaults apply.",
			];

		const runContext = [
			"## Run Context (injected by extension — do not edit)",
			"",
			`RUN_ID: ${run.runId}`,
			`RUN_DIR: ${run.runDir}`,
			`WORKTREE_ROOT: ${run.worktreeRoot}`,
			`BASE_BRANCH: ${run.baseBranch}`,
			`PLAN_SOURCE: ${planSourceLabel(run.planSource, ctx.cwd)}`,
			...modelInstructions,
			"",
			"Use the `subagent` tool for all subprocess work.",
			"Set `cwd` to the appropriate worktree directory for each task.",
		].join("\n");

		return {
			systemPrompt: event.systemPrompt + "\n\n" + promptContent + "\n\n" + runContext,
		};
	});

	// ------------------------------------------------------------------
	// tool_result hook — artifact scanning
	// ------------------------------------------------------------------

	pi.on("tool_result", async (_event, ctx) => {
		if (!activeRun) return;

		const run = activeRun;

		// Scan task artifacts for status changes
		const { updated, newStatuses } = scanTaskArtifacts(run.runDir, run.tasks);
		run.tasks = updated;

		// Emit events for new status transitions
		for (const [taskId, newStatus] of newStatuses) {
			const lastKnown = lastKnownStatuses.get(taskId);
			if (lastKnown !== newStatus) {
				appendJsonlEvent(path.join(run.runDir, EVENTS_FILE), {
					type: `task_${newStatus}`,
					timestamp: new Date().toISOString(),
					taskId,
					status: newStatus,
				});
				lastKnownStatuses.set(taskId, newStatus);
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

		const events = readJsonlEvents<BuildEvent>(path.join(activeRun.runDir, EVENTS_FILE));
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
		resumeMsg += ` Run dir: ${run.runDir}.`;
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

			// Backward compat: old sessions stored planDir as a string
			const oldData = data as any;
			const planSource: PlanSource = data.planSource
				?? (oldData.planDir ? { type: "dir", path: oldData.planDir } : { type: "inline", text: "(unknown)" });

			activeRun = {
				runId: data.runId,
				planSource,
				baseBranch: data.baseBranch ?? "main",
				runDir: data.runDir ?? "",
				worktreeRoot: data.worktreeRoot ?? "",
				tasks: Array.isArray(data.tasks) ? data.tasks : [],
				modelOverride: data.modelOverride ?? oldData.modelSpec ?? null,
				startedAt: data.startedAt ?? "",
			};
		}

		// Also scan filesystem for most recent run
		const recentRunDir = findMostRecentRunDir(ctx.cwd);
		if (recentRunDir) {
			const events = readJsonlEvents<BuildEvent>(path.join(recentRunDir, EVENTS_FILE));
			const phase = deriveRunPhase(events, activeRun?.tasks ?? []);

			if (!isTerminalPhase(phase)) {
				if (!activeRun || activeRun.runDir !== recentRunDir) {
					activeRun = activeRun ?? {
						runId: path.basename(recentRunDir),
						planSource: { type: "inline", text: "(restored from filesystem)" },
						baseBranch: "main",
						runDir: recentRunDir,
						worktreeRoot: path.join(path.dirname(recentRunDir), WORKTREE_ROOT_NAME),
						tasks: [],
						modelOverride: null,
						startedAt: "",
					};

					const startEvent = events.find((e) => e.type === "run_started");
					if (startEvent?.detail) {
						const planMatch = startEvent.detail.match(/Plan:\s*(.+?),/);
						const modelMatch = startEvent.detail.match(/Model:\s*(.+)/);
						if (planMatch) activeRun.planSource = { type: "dir", path: planMatch[1].trim() };
						if (modelMatch) {
							const model = modelMatch[1].trim();
							activeRun.modelOverride = model === "agent-defaults" ? null : model;
						}
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
