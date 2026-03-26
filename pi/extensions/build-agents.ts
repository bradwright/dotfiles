import * as fs from "node:fs";
import * as path from "node:path";

import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@mariozechner/pi-coding-agent";
import {
	AutoResumeTracker,
	localIsoDate,
	slugify,
	toDisplayPath,

	normalizeInputPath,
} from "./lib/shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlanSource =
	| { type: "file"; path: string }
	| { type: "dir"; path: string }
	| { type: "inline"; text: string };

type RoleModels = {
	planner: string;
	implementer: string;
	reviewer: string;
	merger: string;
};

type BuildRunState = {
	runId: string;
	planSource: PlanSource;
	baseBranch: string;
	runDir: string;
	roleModels: RoleModels;
	startedAt: string;
};

type RunPhase = "running" | "canceled" | "completed" | "failed";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_ENTRY = "build-agents-state";
const STATUS_FILE = "status.json";
const BUILD_ROOT = ".pi/build";

const COMMAND_USAGE =
	"/build — start a build\n/build [file|dir|description]\n/build status\n/build cancel\n/build cleanup";



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
// Run status (status.json)
// ---------------------------------------------------------------------------

function readRunPhase(runDir: string): RunPhase | null {
	const statusPath = path.join(runDir, STATUS_FILE);
	if (!fs.existsSync(statusPath)) return null;
	try {
		const data = JSON.parse(fs.readFileSync(statusPath, "utf8"));
		return typeof data.phase === "string" ? data.phase as RunPhase : null;
	} catch {
		return null;
	}
}

function readRunStep(runDir: string): string | null {
	const statusPath = path.join(runDir, STATUS_FILE);
	if (!fs.existsSync(statusPath)) return null;
	try {
		const data = JSON.parse(fs.readFileSync(statusPath, "utf8"));
		return typeof data.step === "string" ? data.step : null;
	} catch {
		return null;
	}
}

function wildcardPatternToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`, "i");
}

function normalizeEnabledModelPattern(raw: string): string {
	const trimmed = raw.trim();
	return trimmed.replace(/:(off|minimal|low|medium|high|xhigh)$/i, "");
}

function getPinnedConcreteModels(cwd: string, availableLabels: string[]): string[] {
	const settingsCandidates = [
		path.join(cwd, "pi", "settings.json"),
		path.join(cwd, ".pi", "settings.json"),
		path.join(getAgentDir(), "settings.json"),
		path.join(process.env.HOME ?? "", ".pi", "settings.json"),
	];

	let enabledPatterns: string[] = [];
	for (const candidate of settingsCandidates) {
		if (!candidate || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
		try {
			const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { enabledModels?: unknown };
			if (Array.isArray(parsed.enabledModels)) {
				enabledPatterns = parsed.enabledModels.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
				break;
			}
		} catch {
			// ignore invalid settings file and keep searching
		}
	}

	if (enabledPatterns.length === 0) return [];

	const normalizedPatterns = enabledPatterns
		.map((pattern) => normalizeEnabledModelPattern(pattern))
		.filter((pattern) => pattern.length > 0);
	if (normalizedPatterns.length === 0) return [];

	const regexes = normalizedPatterns.map((pattern) => wildcardPatternToRegex(pattern));
	const matches = availableLabels.filter((label) => {
		const modelId = label.includes("/") ? label.split("/").slice(1).join("/") : label;
		return regexes.some((rx) => rx.test(label) || rx.test(modelId));
	});

	return Array.from(new Set(matches));
}

function writeRunPhase(runDir: string, phase: RunPhase, step?: string): void {
	const statusPath = path.join(runDir, STATUS_FILE);
	let existing: Record<string, unknown> = {};
	try {
		existing = JSON.parse(fs.readFileSync(statusPath, "utf8"));
	} catch { /* ignore */ }
	const data = { ...existing, phase, updatedAt: new Date().toISOString() };
	if (step !== undefined) data.step = step;
	fs.writeFileSync(statusPath, JSON.stringify(data) + "\n");
}

function isTerminalPhase(phase: RunPhase | null): boolean {
	return phase === "completed" || phase === "failed" || phase === "canceled";
}

// ---------------------------------------------------------------------------
// Run directory discovery
// ---------------------------------------------------------------------------

function isRunDir(dir: string): boolean {
	return fs.existsSync(path.join(dir, STATUS_FILE));
}

function findMostRecentRunDir(cwd: string): string | null {
	const buildRoot = path.join(cwd, BUILD_ROOT);
	if (!fs.existsSync(buildRoot)) return null;

	try {
		const dirs = fs
			.readdirSync(buildRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => path.join(buildRoot, e.name))
			.filter((dir) => isRunDir(dir))
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
			.filter((e) => e.isDirectory())
			.map((e) => path.join(buildRoot, e.name))
			.filter((dir) => {
				if (!isRunDir(dir)) return false;
				return !isTerminalPhase(readRunPhase(dir));
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

	const autoResume = new AutoResumeTracker();

	function persistState(): void {
		if (activeRun) {
			pi.appendEntry<BuildRunState>(STATE_ENTRY, activeRun);
		}
	}

	// ------------------------------------------------------------------
	// Command: /build
	// ------------------------------------------------------------------

	// ------------------------------------------------------------------
	// Resolve plan source from args or interactive picker
	// ------------------------------------------------------------------

	async function resolvePlanSource(args: string, ctx: ExtensionContext): Promise<PlanSource | null> {
		if (args) {
			const resolved = normalizeInputPath(args, ctx.cwd);

			if (fs.existsSync(resolved)) {
				const stat = fs.statSync(resolved);
				if (stat.isFile()) return { type: "file", path: resolved };
				if (stat.isDirectory()) return { type: "dir", path: resolved };
			}

			return { type: "inline", text: args };
		}

		// No args — ask what to build
		const text = await ctx.ui.input("What should be built?");
		if (!text?.trim()) return null;
		return { type: "inline", text: text.trim() };
	}

	function planFilePath(planSource: PlanSource): string {
		switch (planSource.type) {
			case "file": return planSource.path;
			case "dir": return path.join(planSource.path, "plan.md");
			case "inline": return "";
		}
	}

	// ------------------------------------------------------------------
	// Single-agent build
	// ------------------------------------------------------------------

	async function handleSingleAgent(planSource: PlanSource, ctx: ExtensionContext): Promise<void> {
		const planFile = planFilePath(planSource);
		if (!planFile) {
			ctx.ui.notify("Single-agent build requires a plan file, not inline text.", "warning");
			return;
		}
		if (!fs.existsSync(planFile)) {
			ctx.ui.notify(`Plan file not found: ${toDisplayPath(planFile, ctx.cwd)}`, "warning");
			return;
		}

		const THINKING_LEVELS = ["low", "medium", "high", "xhigh"] as const;
		type Level = typeof THINKING_LEVELS[number];
		let level: Level = "medium";
		if (ctx.hasUI) {
			const choice = await ctx.ui.select("Thinking level:", THINKING_LEVELS as unknown as string[]);
			if (!choice) return;
			level = choice as Level;
		}

		pi.setThinkingLevel(level);
		ctx.ui.notify(`Single-agent build. Thinking: ${level}. Plan: ${toDisplayPath(planFile, ctx.cwd)}.`, "info");

		pi.sendUserMessage(
			`Start implementing now using ${planFile} as the guide. Read the full plan.md first — especially the Must-Haves section, which defines what must be true when you're done. Execute the Implementation Plan steps in order. After completing each step, verify it using the step's own verification criteria before proceeding. Run the Validation Checklist before finishing. Do not modify plan package files unless explicitly asked.`,
		);
	}

	// ------------------------------------------------------------------
	// Multi-agent build
	// ------------------------------------------------------------------

	async function handleMultiAgent(planSource: PlanSource, ctx: ExtensionContext): Promise<void> {
		// Concurrent run guard
		const activeRunDirs = findActiveRunDirs(ctx.cwd);
		if (activeRunDirs.length > 0) {
			const proceed = await ctx.ui.confirm(
				"Active build run detected",
				`Active build run found (${activeRunDirs.map((d) => path.basename(d)).join(", ")}). Cancel and start new?`,
			);
			if (!proceed) {
				ctx.ui.notify("Aborted. Existing run is still active.", "info");
				return;
			}
			for (const runDir of activeRunDirs) {
				writeRunPhase(runDir, "canceled");
			}
		}

		// Plan mode gate
		const activeTools = pi.getActiveTools();
		if (!activeTools.includes("bash") || !activeTools.includes("write")) {
			ctx.ui.notify("Build requires full tool access. Run /plan off first.", "warning");
			return;
		}

		// Agent tool check
		if (!activeTools.includes("Agent")) {
			ctx.ui.notify("Multi-agent build requires the Agent tool. Install with: pi install npm:@tintinweb/pi-subagents", "warning");
			return;
		}

		// Clean git check
		const diffResult = await pi.exec("git", ["diff", "--quiet"]);
		const diffCachedResult = await pi.exec("git", ["diff", "--cached", "--quiet"]);
		if (diffResult.code !== 0 || diffCachedResult.code !== 0) {
			ctx.ui.notify("Working tree has uncommitted changes. Commit or stash before starting a build.", "warning");
			return;
		}

		// Per-role model picker
		// Resolve pinned patterns (enabledModels) to concrete available models,
		// then pick per role. Never pass wildcard patterns to Agent.model.
		const allAvailableModels = ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`);
		if (allAvailableModels.length === 0) {
			ctx.ui.notify("No available models found in model registry.", "warning");
			return;
		}

		const pinnedConcreteModels = getPinnedConcreteModels(ctx.cwd, allAvailableModels);
		if (pinnedConcreteModels.length === 0) {
			ctx.ui.notify("No pinned models resolved from enabledModels. Update enabledModels or select a model via Ctrl+L first.", "warning");
			return;
		}

		const roles: Array<{ key: keyof RoleModels; label: string; thinking: string }> = [
			{ key: "planner", label: "Planner (task decomposition, thinking: high)", thinking: "high" },
			{ key: "implementer", label: "Implementer (code generation, thinking: medium)", thinking: "medium" },
			{ key: "reviewer", label: "Reviewer (code review, thinking: medium)", thinking: "medium" },
			{ key: "merger", label: "Merger (git ops, thinking: low)", thinking: "low" },
		];

		const roleModels: Partial<RoleModels> = {};
		for (const role of roles) {
			const selected = await ctx.ui.select(`Model for ${role.label}:`, pinnedConcreteModels);
			if (!selected) return;
			// Store as "provider/model:thinking" — the provider/model part is passed
			// to Agent(model:) and the thinking part to Agent(thinking:).
			roleModels[role.key] = `${selected}:${role.thinking}`;
		}

		// Create run directory
		const planSlug = planSourceSlug(planSource);
		const runId = `${localIsoDate()}-${planSlug}`;
		const runDir = path.join(ctx.cwd, BUILD_ROOT, runId);
		fs.mkdirSync(runDir, { recursive: true });

		// Get base branch
		const branchResult = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
		let baseBranch = (branchResult.stdout || "main").trim();

		if (baseBranch === "main" || baseBranch === "master") {
			const action = await ctx.ui.select(
				`You're on ${baseBranch}. Create a new branch?`,
				["Create new branch", `Stay on ${baseBranch}`],
			);
			if (!action) return;

			if (action === "Create new branch") {
				const branchName = await ctx.ui.input("Branch name:", `build/${planSlug}`);
				if (!branchName?.trim()) return;
				const checkoutResult = await pi.exec("git", ["checkout", "-b", branchName.trim()]);
				if (checkoutResult.code !== 0) {
					ctx.ui.notify(`Failed to create branch: ${(checkoutResult.stderr || checkoutResult.stdout).trim()}`, "error");
					return;
				}
				baseBranch = branchName.trim();
				ctx.ui.notify(`Created and switched to branch ${baseBranch}.`, "info");
			}
		}

		writeRunPhase(runDir, "running", "plan_pending");

		activeRun = {
			runId,
			planSource,
			baseBranch,
			runDir,
			roleModels: roleModels as RoleModels,
			startedAt: new Date().toISOString(),
		};
		persistState();
		autoResume.reset();

		const rm = roleModels as RoleModels;
		const kickoffMsg = [
			`Multi-agent build started.`,
			`Run ID: ${runId}`,
			`Run directory: ${runDir}`,
			`Plan source: ${planSourceLabel(planSource, ctx.cwd)}`,
			`Base branch: ${baseBranch}`,
			``,
			`Per-role models (format: provider/modelId:thinking_level):`,
			`  build-planner:  ${rm.planner}`,
			`  implementer:    ${rm.implementer}`,
			`  build-reviewer: ${rm.reviewer}`,
			`  merger:         ${rm.merger}`,
			``,
			planSourceForKickoff(planSource),
			``,
			`Use the \`Agent\` tool for all subprocess work:`,
			`- Split each ROLE_MODELS value on the LAST colon: before ':' => model, after ':' => thinking`,
			`- Task decomposition: Agent() with subagent_type "build-planner", model + thinking from build-planner ROLE_MODELS`,
			`- Parallel implementers: Agent() with subagent_type "implementer", model + thinking from implementer ROLE_MODELS, isolation: "worktree", run_in_background: true`,
			`- Reviews: Agent() with subagent_type "build-reviewer", model + thinking from build-reviewer ROLE_MODELS`,
			`- Merge: Agent() with subagent_type "merger", model + thinking from merger ROLE_MODELS`,
			``,
			`Implementers write RESULT.md in their worktree. Reviewers write REVIEW.md.`,
			`Use get_subagent_result to collect results after agents complete.`,
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

			const phase = readRunPhase(recentRunDir) ?? "running";
			ctx.ui.notify(
				`Last run: ${path.basename(recentRunDir)}\nPhase: ${phase}\nDir: ${toDisplayPath(recentRunDir, ctx.cwd)}`,
				"info",
			);
			return;
		}

		const run = activeRun;
		const phase = readRunPhase(run.runDir) ?? "running";

		const lines = [
			`Run: ${run.runId}`,
			`Phase: ${phase}`,
			`Plan: ${planSourceLabel(run.planSource, ctx.cwd)}`,
			`Branch: ${run.baseBranch}`,
			`Models: planner=${run.roleModels.planner}, impl=${run.roleModels.implementer}, reviewer=${run.roleModels.reviewer}, merger=${run.roleModels.merger}`,
			`Started: ${run.startedAt}`,
		];

		ctx.ui.notify(lines.join("\n"), "info");
	}

	async function handleCancel(ctx: ExtensionContext): Promise<void> {
		if (!activeRun) {
			ctx.ui.notify("No active build run to cancel.", "warning");
			return;
		}

		writeRunPhase(activeRun.runDir, "canceled");
		ctx.ui.notify(`Build run ${activeRun.runId} canceled.`, "info");
		activeRun = null;
	}

	async function handleCleanup(ctx: ExtensionContext): Promise<void> {
		let cleaned = 0;

		// Clean orphaned worktrees via git
		const listResult = await pi.exec("git", ["worktree", "list", "--porcelain"]);
		if (listResult.code === 0) {
			const worktreeLines = listResult.stdout.split("\n").filter((l) => l.startsWith("worktree "));
			for (const line of worktreeLines) {
				const wtPath = line.replace("worktree ", "").trim();
				// Skip the main worktree
				if (wtPath === ctx.cwd) continue;
				const result = await pi.exec("git", ["worktree", "remove", "--force", wtPath]);
				if (result.code === 0) cleaned++;
			}
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

	pi.registerCommand("build", {
		description: "Build from a plan. Subcommands: status/cancel/cleanup",
		handler: async (args, ctx) => {
			const trimmed = args.trim();

			// Subcommands that don't take plan args
			if (/^status\b/i.test(trimmed)) { await handleStatus(ctx); return; }
			if (/^cancel\b/i.test(trimmed)) { await handleCancel(ctx); return; }
			if (/^cleanup\b/i.test(trimmed)) { await handleCleanup(ctx); return; }

			// Resolve plan source
			const planSource = await resolvePlanSource(trimmed, ctx);
			if (!planSource) return;

			// Pick build mode
			const hasAgent = pi.getActiveTools().includes("Agent");
			const modeOptions = hasAgent
				? ["Single agent", "Multi-agent (parallel workers)"]
				: ["Single agent"];
			const modeChoice = modeOptions.length === 1
				? modeOptions[0]
				: await ctx.ui.select("Build mode:", modeOptions);
			if (!modeChoice) return;

			if (modeChoice.includes("Multi-agent")) {
				await handleMultiAgent(planSource, ctx);
			} else {
				await handleSingleAgent(planSource, ctx);
			}
		},
	});

	// ------------------------------------------------------------------
	// System prompt injection (before_agent_start)
	// ------------------------------------------------------------------

	pi.on("before_agent_start", async (event, ctx) => {
		if (!activeRun) return;

		autoResume.tick();

		const promptPath = path.join(__dirname, "build-agents-prompt.md");
		if (!fs.existsSync(promptPath)) {
			ctx.ui.notify(
				`⚠️ build-agents-prompt.md not found at ${promptPath}. Ensure it is co-located with the extension.`,
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
		const rm = run.roleModels;

		const runContext = [
			"## Run Context (injected by extension — do not edit)",
			"",
			`RUN_ID: ${run.runId}`,
			`RUN_DIR: ${run.runDir}`,
			`BASE_BRANCH: ${run.baseBranch}`,
			`PLAN_SOURCE: ${planSourceLabel(run.planSource, ctx.cwd)}`,
			"",
			"ROLE_MODELS (format is `provider/modelId:thinking_level`):",
			`  build-planner:  ${rm.planner}`,
			`  implementer:    ${rm.implementer}`,
			`  build-reviewer: ${rm.reviewer}`,
			`  merger:         ${rm.merger}`,
			"",
			"Split each ROLE_MODELS value on the LAST colon to get the Agent() parameters:",
			"  - Everything before the last `:` → `model` (e.g. `anthropic/claude-opus-4-6`)",
			"  - Everything after the last `:` → `thinking` (e.g. `high`)",
			"Use `isolation: \"worktree\"` for implementer tasks. Use `run_in_background: true` for parallel execution.",
			"Artifacts (RESULT.md, REVIEW.md) live in worktrees — use `get_subagent_result` to collect them.",
		].join("\n");

		return {
			systemPrompt: event.systemPrompt + "\n\n" + promptContent + "\n\n" + runContext,
		};
	});

	// ------------------------------------------------------------------
	// Auto-resume on agent_end
	// ------------------------------------------------------------------

	pi.on("agent_end", async (_event, ctx) => {
		if (!activeRun) return;

		const phase = readRunPhase(activeRun.runDir);
		if (isTerminalPhase(phase)) return;

		// Guard: if supervisor marked step as merged but forgot to set terminal phase,
		// finalize the run here to prevent endless auto-resume prompts.
		const step = readRunStep(activeRun.runDir);
		if (phase === "running" && step === "merged") {
			writeRunPhase(activeRun.runDir, "completed", "merged");
			ctx.ui.notify(`Build run ${activeRun.runId} marked completed (step=merged).`, "info");
			activeRun = null;
			return;
		}

		const resume = autoResume.shouldResume();
		if (!resume.ok) {
			if (resume.reason === "exhausted") {
				ctx.ui.notify("Build auto-resume limit reached. Use /build to re-activate.", "info");
			}
			return;
		}

		const run = activeRun;
		// Read current step from status.json so the supervisor knows where to resume
		let stepInfo = "";
		try {
			const status = JSON.parse(fs.readFileSync(path.join(run.runDir, STATUS_FILE), "utf8"));
			if (status.step) stepInfo = `\nCurrent step: ${status.step}. Read status.json in the run dir for full state.`;
		} catch { /* ignore */ }
		pi.sendUserMessage(
			`Build context limit reached. Resume orchestrating the multi-agent build.\n` +
			`Run dir: ${run.runDir}.${stepInfo}\n` +
			`Check ${run.runDir}/status.json for build step, then use get_subagent_result to check on any running agents.`,
		);
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

			const defaultRoleModels: RoleModels = { planner: "unknown", implementer: "unknown", reviewer: "unknown", merger: "unknown" };
			activeRun = {
				runId: data.runId,
				planSource,
				baseBranch: data.baseBranch ?? "main",
				runDir: data.runDir ?? "",
				roleModels: data.roleModels ?? defaultRoleModels,
				startedAt: data.startedAt ?? "",
			};
		}

		// Also scan filesystem for most recent run
		const recentRunDir = findMostRecentRunDir(ctx.cwd);
		if (recentRunDir) {
			const phase = readRunPhase(recentRunDir);
			const step = readRunStep(recentRunDir);

			// Guard: stale running status after successful merge.
			if (phase === "running" && step === "merged") {
				writeRunPhase(recentRunDir, "completed", "merged");
				if (activeRun?.runDir === recentRunDir) activeRun = null;
				return;
			}

			if (!isTerminalPhase(phase)) {
				if (!activeRun || activeRun.runDir !== recentRunDir) {
					const defaultRoleModels2: RoleModels = { planner: "unknown", implementer: "unknown", reviewer: "unknown", merger: "unknown" };
					activeRun = {
						runId: path.basename(recentRunDir),
						planSource: { type: "inline", text: "(restored from filesystem)" },
						baseBranch: "main",
						runDir: recentRunDir,
						roleModels: defaultRoleModels2,
						startedAt: "",
					};
				}

				ctx.ui.notify(`Active build run found: ${activeRun.runId}`, "info");
			}
		}

	});
}
