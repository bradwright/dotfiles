import * as fs from "node:fs";
import * as path from "node:path";

import { isToolCallEventType, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, Text } from "@mariozechner/pi-tui";

const PLAN_TOOLS = ["read", "bash", "grep", "find", "ls", "edit", "write"] as const;
const FALLBACK_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
const REQUIRED_PLAN_FILES = ["plan.md", "feedback.md", "changelog.md"] as const;
const ISSUE_BRIEF_FILE = "brief.md";
const EVENTS_FILE = "events.jsonl";

const STATE_ENTRY = "plan-state";
const LEGACY_STATE_ENTRY = "plan-mode-state";
const STATUS_KEY = "plan";
const PLAN_CONTEXT_TYPE = "plan-context";

const PLAN_USAGE =
	"/plan — start new plan or activate existing plan\n/plan new [context|github-url]\n/plan resume [plan-dir]\n/plan review | clear | status | mode";

const GITHUB_ISSUE_FETCH_TIMEOUT_MS = 15000;
const GITHUB_ISSUE_BODY_MAX_CHARS = 12000;

const SAFE_BASH_PATTERNS = [
	/^\s*cat\b/i,
	/^\s*head\b/i,
	/^\s*tail\b/i,
	/^\s*less\b/i,
	/^\s*more\b/i,
	/^\s*grep\b/i,
	/^\s*find\b/i,
	/^\s*ls\b/i,
	/^\s*pwd\b/i,
	/^\s*echo\b/i,
	/^\s*printf\b/i,
	/^\s*wc\b/i,
	/^\s*sort\b/i,
	/^\s*uniq\b/i,
	/^\s*diff\b/i,
	/^\s*file\b/i,
	/^\s*stat\b/i,
	/^\s*du\b/i,
	/^\s*df\b/i,
	/^\s*tree\b/i,
	/^\s*which\b/i,
	/^\s*whereis\b/i,
	/^\s*type\b/i,
	/^\s*env\b/i,
	/^\s*printenv\b/i,
	/^\s*uname\b/i,
	/^\s*whoami\b/i,
	/^\s*id\b/i,
	/^\s*date\b/i,
	/^\s*uptime\b/i,
	/^\s*ps\b/i,
	/^\s*top\b/i,
	/^\s*htop\b/i,
	/^\s*git\s+(status|log|diff|show|branch|remote|rev-parse|config\s+--get)\b/i,
	/^\s*git\s+ls-\S+\b/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
	/^\s*yarn\s+(list|info|why|audit)\b/i,
	/^\s*pnpm\s+(list|ls|view|info|search|outdated|audit)\b/i,
	/^\s*node\s+--version\b/i,
	/^\s*python\s+--version\b/i,
	/^\s*python3\s+--version\b/i,
	/^\s*curl\b/i,
	/^\s*wget\s+-O\s*-\b/i,
	/^\s*jq\b/i,
	/^\s*sed\s+-n\b/i,
	/^\s*awk\b/i,
	/^\s*rg\b/i,
	/^\s*fd\b/i,
	/^\s*bat\b/i,
] as const;

const BLOCKED_BASH_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bxargs\b/i,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)\b/i,
	/\byarn\s+(add|remove|install|publish)\b/i,
	/\bpnpm\s+(add|remove|install|publish)\b/i,
	/\bpip\s+(install|uninstall)\b/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)\b/i,
	/\bbrew\s+(install|uninstall|upgrade)\b/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|stash|cherry-pick|revert|tag|init|clone)\b/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
	/\b(bash|sh|zsh)\b\s+-c\b/i,
] as const;

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const PLAN_THINKING_LEVELS: ThinkingLevel[] = ["medium", "high", "xhigh"];
const BUILD_THINKING_LEVELS: ThinkingLevel[] = ["low", "medium", "high", "xhigh"];

type PlanState = {
	enabled: boolean;
	activePlanDir: string | null;
	previousTools: string[];
	planThinkingLevel: ThinkingLevel;
	buildThinkingLevel: ThinkingLevel;
	previousThinkingLevel: ThinkingLevel | null;
};

type GitHubIssueRef = {
	owner: string;
	repo: string;
	number: number;
	url: string;
};

type GitHubIssue = {
	owner: string;
	repo: string;
	number: number;
	url: string;
	title: string;
	body: string;
	state: string;
	author: string;
	labels: string[];
};

// ---------------------------------------------------------------------------
// Structured event log (events.jsonl)
// ---------------------------------------------------------------------------

type PlanEventType = "created" | "draft" | "edit" | "review" | "approved" | "build_started";

type PlanEvent = {
	type: PlanEventType;
	timestamp: string;
	model?: string;
	version?: number;
	summary?: string;
};

/** Metadata derived from events.jsonl for display in the widget. */
type PlanMeta = {
	currentDraft: number;
	reviewCount: number;
	isApproved: boolean;
	lastEvent: PlanEventType | null;
	lastModel: string | null;
};

function readPlanEvents(planDir: string): PlanEvent[] {
	const eventsPath = path.join(planDir, EVENTS_FILE);
	if (!fs.existsSync(eventsPath)) return [];
	try {
		return fs
			.readFileSync(eventsPath, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line) as PlanEvent;
				} catch {
					return null;
				}
			})
			.filter((event): event is PlanEvent => event !== null);
	} catch {
		return [];
	}
}

function appendPlanEvent(planDir: string, event: PlanEvent): void {
	const eventsPath = path.join(planDir, EVENTS_FILE);
	fs.appendFileSync(eventsPath, JSON.stringify(event) + "\n");
}

function derivePlanMeta(events: PlanEvent[]): PlanMeta {
	let currentDraft = 0;
	let reviewCount = 0;
	let isApproved = false;
	let lastEvent: PlanEventType | null = null;
	let lastModel: string | null = null;

	for (const event of events) {
		lastEvent = event.type;
		if (event.model) lastModel = event.model;

		if (event.type === "draft") {
			currentDraft = event.version ?? currentDraft + 1;
		} else if (event.type === "review") {
			reviewCount++;
		} else if (event.type === "approved") {
			isApproved = true;
		}
	}

	return { currentDraft, reviewCount, isApproved, lastEvent, lastModel };
}

/**
 * Derive plan metadata by parsing changelog.md.
 * Works for plans that predate events.jsonl, and supplements event-based metadata.
 */
function derivePlanMetaFromChangelog(planDir: string): PlanMeta {
	const changelogPath = path.join(planDir, "changelog.md");
	if (!fs.existsSync(changelogPath)) return { currentDraft: 0, reviewCount: 0, isApproved: false, lastEvent: null, lastModel: null };

	try {
		const content = fs.readFileSync(changelogPath, "utf8");
		const lines = content.split("\n");
		let currentDraft = 0;
		let reviewCount = 0;
		let isApproved = false;
		let lastEvent: PlanEventType | null = null;
		let lastModel: string | null = null;

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("-")) continue;

			// Match "- Draft N — YYYY-MM-DD, model-name: ..."
			const draftMatch = trimmed.match(/^-\s+Draft\s+(\d+)\s+[—-]\s+\d{4}-\d{2}-\d{2},\s+(\S+?):/i);
			if (draftMatch) {
				currentDraft = parseInt(draftMatch[1], 10);
				lastModel = draftMatch[2];
				lastEvent = "draft";
				continue;
			}

			// Match "- Review — YYYY-MM-DD, model-name: ..."
			const reviewMatch = trimmed.match(/^-\s+Review\s+[—-]\s+\d{4}-\d{2}-\d{2},\s+(\S+?):/i);
			if (reviewMatch) {
				reviewCount++;
				lastModel = reviewMatch[1];
				lastEvent = "review";
				continue;
			}

			// Match "- Edit — YYYY-MM-DD, model-name: ..."
			const editMatch = trimmed.match(/^-\s+Edit\s+[—-]\s+\d{4}-\d{2}-\d{2},\s+(\S+?):/i);
			if (editMatch) {
				lastModel = editMatch[1];
				lastEvent = "edit";
				continue;
			}

			// Match "- Approved — YYYY-MM-DD, user."
			if (/^-\s+Approved\s+[—-]\s+\d{4}-\d{2}-\d{2},\s+user\./i.test(trimmed)) {
				isApproved = true;
				lastEvent = "approved";
				continue;
			}
		}

		return { currentDraft, reviewCount, isApproved, lastEvent, lastModel };
	} catch {
		return { currentDraft: 0, reviewCount: 0, isApproved: false, lastEvent: null, lastModel: null };
	}
}

/**
 * Get the best available plan metadata, preferring events.jsonl and falling
 * back to changelog.md parsing for older plans.
 */
function getPlanMeta(planDir: string): PlanMeta {
	const events = readPlanEvents(planDir);
	if (events.length > 0) {
		return derivePlanMeta(events);
	}
	return derivePlanMetaFromChangelog(planDir);
}

/** Count unresolved feedback items (lines starting with "- " under # Feedback). */
function countFeedbackItems(planDir: string): number {
	const feedbackPath = path.join(planDir, "feedback.md");
	if (!fs.existsSync(feedbackPath)) return 0;
	try {
		const content = fs.readFileSync(feedbackPath, "utf8");
		const lines = content.split("\n");
		let count = 0;
		for (const line of lines) {
			if (/^\s*-\s+\S/.test(line)) count++;
		}
		return count;
	} catch {
		return 0;
	}
}

/** Compute readiness score by checking plan.md sections. */
function computeReadiness(planDir: string): { score: number; total: number } {
	const planPath = path.join(planDir, "plan.md");
	if (!fs.existsSync(planPath)) return { score: 0, total: 6 };
	try {
		const content = fs.readFileSync(planPath, "utf8");
		const checks = [
			// Goal section has content
			/## Goal\s*\n(?!\s*##)(.+)/s,
			// Files and Components section has content
			/## Files and Components to Touch\s*\n(?!\s*##)(.+)/s,
			// Implementation Plan has numbered steps
			/## Implementation Plan\s*\n(?!\s*##)[\s\S]*\d+\./s,
			// Risks section has content
			/## Risks \/ Edge Cases\s*\n(?!\s*##)(.+)/s,
			// Validation Checklist has items
			/## Validation Checklist\s*\n(?!\s*##)(.+)/s,
			// Open Questions resolved (section empty or absent)
			(() => {
				const oqMatch = content.match(/## Open Questions\s*\n([\s\S]*?)(?=\n##|$)/);
				if (!oqMatch) return true; // no section = resolved
				const body = oqMatch[1].trim();
				return body.length === 0 || /^\s*(?:none|n\/a|resolved|—)\s*$/im.test(body);
			})(),
		];

		let score = 0;
		for (const check of checks) {
			if (typeof check === "boolean") {
				if (check) score++;
			} else if (check.test(content)) {
				score++;
			}
		}
		return { score, total: 6 };
	} catch {
		return { score: 0, total: 6 };
	}
}

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

function toTitleCase(value: string): string {
	return value
		.split(/[-\s]+/)
		.filter(Boolean)
		.map((part) => part[0].toUpperCase() + part.slice(1))
		.join(" ");
}

function stripMatchingQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

function expandHome(inputPath: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return inputPath;
	if (inputPath === "~") return home;
	if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
		return path.join(home, inputPath.slice(2));
	}
	return inputPath;
}

function normalizeInputPath(inputPath: string, cwd: string): string {
	const trimmed = stripMatchingQuotes(inputPath.trim()).replace(/^@/, "");
	const expanded = expandHome(trimmed);
	return path.resolve(cwd, expanded);
}

function resolvePathForContainment(inputPath: string, cwd: string): string {
	const normalized = normalizeInputPath(inputPath, cwd);

	try {
		return fs.realpathSync(normalized);
	} catch {
		const parent = path.dirname(normalized);
		try {
			const realParent = fs.realpathSync(parent);
			return path.join(realParent, path.basename(normalized));
		} catch {
			return normalized;
		}
	}
}

function isWithinDirectory(targetPath: string, directoryPath: string): boolean {
	const rel = path.relative(path.resolve(directoryPath), path.resolve(targetPath));
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function toDisplayPath(targetPath: string, cwd: string): string {
	const resolved = path.resolve(targetPath);
	const fromCwd = path.relative(cwd, resolved);
	if (!fromCwd.startsWith("..") && !path.isAbsolute(fromCwd)) return `./${fromCwd}`;

	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && resolved.startsWith(home)) return `~${resolved.slice(home.length)}`;

	return resolved;
}

function requiredFilesMissing(planDir: string): string[] {
	return REQUIRED_PLAN_FILES.filter((file) => !fs.existsSync(path.join(planDir, file)));
}

function listAvailablePlanDirs(cwd: string): string[] {
	const plansRoot = path.join(cwd, ".pi", "plans");
	if (!fs.existsSync(plansRoot) || !fs.statSync(plansRoot).isDirectory()) return [];

	const dirs = fs
		.readdirSync(plansRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(plansRoot, entry.name))
		.filter((dir) => requiredFilesMissing(dir).length === 0)
		.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));

	return dirs;
}

function hasApprovedEntry(changelogPath: string): boolean {
	if (!fs.existsSync(changelogPath) || !fs.statSync(changelogPath).isFile()) return false;
	const content = fs.readFileSync(changelogPath, "utf8");
	return /^\s*-\s*Approved\s+[—-]\s+\d{4}-\d{2}-\d{2},\s+user\./m.test(content);
}

function planTemplate(title: string): string {
	return `# Plan: ${title}\n\n## Goal\n\n## Context and Constraints\n\n## Files and Components to Touch\n\n## Implementation Plan\n1.\n\n## Risks / Edge Cases\n\n## Validation Checklist\n\n## Open Questions\n`;
}

function feedbackTemplate(): string {
	return "# Feedback\n\n";
}

function changelogTemplate(): string {
	return "# Changelog\n\n";
}

function ensurePlanPackage(planDir: string, title: string): string[] {
	fs.mkdirSync(planDir, { recursive: true });

	const created: string[] = [];
	const planPath = path.join(planDir, "plan.md");
	if (!fs.existsSync(planPath)) {
		fs.writeFileSync(planPath, planTemplate(title));
		created.push("plan.md");
	}

	const feedbackPath = path.join(planDir, "feedback.md");
	if (!fs.existsSync(feedbackPath)) {
		fs.writeFileSync(feedbackPath, feedbackTemplate());
		created.push("feedback.md");
	}

	const changelogPath = path.join(planDir, "changelog.md");
	if (!fs.existsSync(changelogPath)) {
		fs.writeFileSync(changelogPath, changelogTemplate());
		created.push("changelog.md");
	}

	return created;
}

function isSafeBashCommand(command: string): boolean {
	const blocked = BLOCKED_BASH_PATTERNS.some((pattern) => pattern.test(command));
	const allowed = SAFE_BASH_PATTERNS.some((pattern) => pattern.test(command));
	return !blocked && allowed;
}

function parsePlanReviewPath(input: string): string | null {
	const match = input.trim().match(/^\/skill:plan\s+review\s+(.+)$/i);
	if (!match) return null;
	return match[1].trim();
}

function parseGitHubIssueUrl(input: string): GitHubIssueRef | null {
	const value = stripMatchingQuotes(input.trim());
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return null;
	}

	if (!/^https?:$/.test(parsed.protocol)) return null;
	if (parsed.hostname.toLowerCase() !== "github.com") return null;

	const parts = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
	if (parts.length < 4 || parts[2] !== "issues") return null;

	const number = Number(parts[3]);
	if (!Number.isInteger(number) || number <= 0) return null;

	const owner = parts[0];
	const repo = parts[1];
	return {
		owner,
		repo,
		number,
		url: `https://github.com/${owner}/${repo}/issues/${number}`,
	};
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	return {
		text: `${text.slice(0, Math.max(0, maxChars - 14)).trimEnd()}\n\n[...truncated]`,
		truncated: true,
	};
}

function formatIssueBrief(issue: GitHubIssue, options: { truncateBody?: boolean } = {}): string {
	const bodySource = issue.body.trim().length > 0 ? issue.body.trim() : "(No issue description provided.)";
	const body = options.truncateBody === false ? { text: bodySource, truncated: false } : truncateText(bodySource, GITHUB_ISSUE_BODY_MAX_CHARS);
	const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "(none)";
	const state = issue.state || "unknown";
	const author = issue.author || "unknown";

	const lines = [
		"GitHub issue brief:",
		`- URL: ${issue.url}`,
		`- Repository: ${issue.owner}/${issue.repo}`,
		`- Issue: #${issue.number}`,
		`- Title: ${issue.title}`,
		`- State: ${state}`,
		`- Author: ${author}`,
		`- Labels: ${labels}`,
		"",
		"Issue body:",
		body.text,
	];

	if (body.truncated) {
		lines.push(`\n(Issue body truncated to ${GITHUB_ISSUE_BODY_MAX_CHARS} characters.)`);
	}

	return lines.join("\n");
}

function persistIssueBriefToPlanPackage(planDir: string, issue: GitHubIssue): void {
	const briefPath = path.join(planDir, ISSUE_BRIEF_FILE);
	const fullBrief = `${formatIssueBrief(issue, { truncateBody: false })}\n`;
	fs.writeFileSync(briefPath, fullBrief);

	const feedbackPath = path.join(planDir, "feedback.md");
	const issueLine = `- User feedback: Source issue ${issue.url} — ${issue.title}`;
	const existing = fs.existsSync(feedbackPath) ? fs.readFileSync(feedbackPath, "utf8") : "# Feedback\n\n";
	const withHeader = existing.trim().length > 0 ? existing : "# Feedback\n\n";
	if (!withHeader.includes(issue.url)) {
		const suffix = withHeader.endsWith("\n") ? "" : "\n";
		fs.writeFileSync(feedbackPath, `${withHeader}${suffix}${issueLine}\n`);
	}
}

export default function plan(pi: ExtensionAPI) {
	let planEnabled = false;
	let activePlanDir: string | null = null;
	let previousTools: string[] = [];
	let planThinkingLevel: ThinkingLevel = "high";
	let buildThinkingLevel: ThinkingLevel = "medium";
	let previousThinkingLevel: ThinkingLevel | null = null;

	// Auto-resume tracking
	let planTurnsThisSession = 0;
	let lastAutoResumeTime = 0;
	const MAX_AUTO_RESUME_TURNS = 5;
	const AUTO_RESUME_COOLDOWN_MS = 60 * 1000; // 1 minute

	function persistState(): void {
		pi.appendEntry<PlanState>(STATE_ENTRY, {
			enabled: planEnabled,
			activePlanDir,
			previousTools,
			planThinkingLevel,
			buildThinkingLevel,
			previousThinkingLevel,
		});
	}

	function planLabel(): string {
		if (!activePlanDir) return "no plan";
		return path.basename(activePlanDir);
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		if (!planEnabled) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.setWidget(STATUS_KEY, undefined);
			return;
		}

		// Status bar: compact label
		const status = `🧭 ${planLabel()}`;
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", status));

		// Widget: richer info line with plan metadata
		if (!activePlanDir || !fs.existsSync(activePlanDir)) {
			ctx.ui.setWidget(STATUS_KEY, undefined);
			return;
		}

		ctx.ui.setWidget(STATUS_KEY, (_tui, theme) => {
			const meta = getPlanMeta(activePlanDir!);
			const feedbackCount = countFeedbackItems(activePlanDir!);
			const readiness = computeReadiness(activePlanDir!);

			const parts: string[] = [];

			// Plan name
			parts.push(theme.fg("accent", `📋 ${planLabel()}`));

			// Draft status
			if (meta.isApproved) {
				parts.push(theme.fg("success", "✓ Approved"));
			} else if (meta.currentDraft > 0) {
				parts.push(theme.fg("warning", `Draft ${meta.currentDraft}`));
			} else {
				parts.push(theme.fg("muted", "No drafts yet"));
			}

			// Review count
			if (meta.reviewCount > 0) {
				parts.push(theme.fg("muted", `${meta.reviewCount} review${meta.reviewCount > 1 ? "s" : ""}`));
			}

			// Feedback items
			if (feedbackCount > 0) {
				parts.push(theme.fg("warning", `${feedbackCount} feedback item${feedbackCount > 1 ? "s" : ""}`));
			}

			// Readiness score
			const readinessColor = readiness.score === readiness.total ? "success"
				: readiness.score >= readiness.total - 1 ? "warning"
				: "muted";
			parts.push(theme.fg(readinessColor as Parameters<typeof theme.fg>[0], `readiness: ${readiness.score}/${readiness.total}`));

			// Last model
			if (meta.lastModel) {
				parts.push(theme.fg("dim", `model: ${meta.lastModel}`));
			}

			// Thinking level
			parts.push(theme.fg("dim", `thinking: ${planThinkingLevel}`));

			return new Text(parts.join(theme.fg("dim", " │ ")), 0, 0);
		});
	}

	function availableToolSet(): Set<string> {
		return new Set(pi.getAllTools().map((tool) => tool.name));
	}

	function computePlanTools(): string[] {
		const available = availableToolSet();
		return PLAN_TOOLS.filter((toolName) => available.has(toolName));
	}

	function computeFallbackTools(): string[] {
		const available = availableToolSet();
		return FALLBACK_TOOLS.filter((toolName) => available.has(toolName));
	}

	function setPlan(
		enabled: boolean,
		ctx: ExtensionContext,
		options: { notify?: boolean; captureCurrentTools?: boolean } = {},
	): void {
		const { notify = true, captureCurrentTools = true } = options;

		if (enabled) {
			if (!planEnabled && captureCurrentTools) {
				previousTools = pi.getActiveTools();
			}
			if (!planEnabled && previousThinkingLevel === null) {
				previousThinkingLevel = pi.getThinkingLevel() as ThinkingLevel;
			}
			pi.setThinkingLevel(planThinkingLevel);

			planEnabled = true;
			const tools = computePlanTools();
			if (tools.length > 0) pi.setActiveTools(tools);
			if (notify) {
				const detail = activePlanDir ? ` Active plan: ${toDisplayPath(activePlanDir, ctx.cwd)}.` : "";
				ctx.ui.notify(`Plan mode enabled. Thinking: ${planThinkingLevel}.${detail}`, "info");
			}
		} else {
			planEnabled = false;
			const available = availableToolSet();
			const restoreTools = (previousTools.length > 0 ? previousTools : computeFallbackTools()).filter((toolName) =>
				available.has(toolName),
			);
			if (restoreTools.length > 0) pi.setActiveTools(restoreTools);
			previousTools = [];
			if (previousThinkingLevel !== null) {
				pi.setThinkingLevel(previousThinkingLevel);
				previousThinkingLevel = null;
			}
			if (notify) ctx.ui.notify("Plan mode disabled. Restored normal tool access and thinking level.", "info");
		}

		updateStatus(ctx);
		persistState();
	}

	function formatStatusSummary(ctx: ExtensionContext): string {
		const mode = planEnabled ? "ON" : "OFF";
		const active = activePlanDir ? toDisplayPath(activePlanDir, ctx.cwd) : "(none)";
		const tools = pi.getActiveTools().join(", ");
		const activeThinking = pi.getThinkingLevel();
		return `Plan mode: ${mode}\nActive plan: ${active}\nPlan thinking: ${planThinkingLevel}\nActive thinking: ${activeThinking}\nActive tools: ${tools}`;
	}

	function setActivePlanDir(nextPlanDir: string | null, ctx: ExtensionContext): void {
		activePlanDir = nextPlanDir ? path.resolve(nextPlanDir) : null;
		updateStatus(ctx);
		persistState();
	}

	function canWriteToActivePlan(rawPath: string, cwd: string): boolean {
		if (!activePlanDir) return false;
		const planRoot = resolvePathForContainment(activePlanDir, cwd);
		const target = resolvePathForContainment(rawPath, cwd);
		return isWithinDirectory(target, planRoot);
	}

	function usage(ctx: ExtensionContext): void {
		ctx.ui.notify(PLAN_USAGE, "warning");
	}

	function queueUserPrompt(prompt: string, ctx: ExtensionContext): void {
		if (ctx.isIdle()) {
			pi.sendUserMessage(prompt);
		} else {
			pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		}
	}

	async function fetchGitHubIssue(ref: GitHubIssueRef): Promise<GitHubIssue> {
		const repoRef = `${ref.owner}/${ref.repo}`;
		const result = await pi.exec(
			"gh",
			[
				"issue",
				"view",
				String(ref.number),
				"--repo",
				repoRef,
				"--json",
				"number,title,body,url,state,author,labels",
			],
			{ timeout: GITHUB_ISSUE_FETCH_TIMEOUT_MS },
		);

		if (result.code !== 0) {
			const details = (result.stderr || result.stdout || `exit code ${result.code}`).trim();
			throw new Error(details);
		}

		let parsed: {
			number?: number;
			title?: string;
			body?: string | null;
			url?: string;
			state?: string;
			author?: { login?: string | null } | null;
			labels?: Array<{ name?: string | null }>;
		};

		try {
			parsed = JSON.parse(result.stdout);
		} catch {
			throw new Error("Failed to parse GitHub issue payload from gh CLI.");
		}

		if (typeof parsed.title !== "string" || parsed.title.trim().length === 0) {
			throw new Error("GitHub issue payload is missing a title.");
		}

		const labels = Array.isArray(parsed.labels)
			? parsed.labels
					.map((label) => (typeof label?.name === "string" ? label.name.trim() : ""))
					.filter((label) => label.length > 0)
			: [];

		return {
			owner: ref.owner,
			repo: ref.repo,
			number: typeof parsed.number === "number" ? parsed.number : ref.number,
			url: typeof parsed.url === "string" && parsed.url.length > 0 ? parsed.url : ref.url,
			title: parsed.title.trim(),
			body: typeof parsed.body === "string" ? parsed.body : "",
			state: typeof parsed.state === "string" ? parsed.state : "",
			author: typeof parsed.author?.login === "string" ? parsed.author.login : "",
			labels,
		};
	}

	pi.registerFlag("plan", {
		description: "Start in plan mode",
		type: "boolean",
		default: false,
	});

	async function promptThinkingLevel(
		label: string,
		levels: ThinkingLevel[],
		current: ThinkingLevel,
		ctx: ExtensionContext,
	): Promise<ThinkingLevel | null> {
		if (!ctx.hasUI) return current;

		const currentIndex = levels.indexOf(current);
		const reordered = [
			...levels.slice(currentIndex),
			...levels.slice(0, currentIndex),
		];
		const choice = await ctx.ui.select(label, reordered as string[]);
		if (!choice) return null;

		const selected = choice as ThinkingLevel;
		return levels.includes(selected) ? selected : null;
	}

	async function handlePlanNew(rest: string, ctx: ExtensionContext): Promise<void> {
		let issue: GitHubIssue | null = null;
		let userContext = rest;
		let slugInput = rest;
		const issueRef = rest ? parseGitHubIssueUrl(rest) : null;

		if (issueRef) {
			ctx.ui.notify(`Fetching GitHub issue ${issueRef.url}...`, "info");
			try {
				issue = await fetchGitHubIssue(issueRef);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(
					`Failed to fetch ${issueRef.url}. Ensure gh is installed and authenticated.\n${reason}`,
					"error",
				);
				return;
			}

			slugInput =
				slugify(`${issue.repo}-issue-${issue.number}-${issue.title}`) ||
				slugify(`${issue.repo}-issue-${issue.number}`) ||
				`issue-${issue.number}`;
		}

		// If no context provided, ask the user what they want to build
		if (!slugInput && ctx.hasUI) {
			const description = (await ctx.ui.input("What do you want to build?", "describe the feature or task"))?.trim() ?? "";
			if (!description) return;
			userContext = description;
			slugInput = description;
		}

		const slug = slugify(slugInput);
		if (!slug) {
			ctx.ui.notify(
				"Provide a description (e.g. /plan new auth-token-refresh) or a GitHub issue URL.",
				"warning",
			);
			return;
		}

		// Prompt for thinking level before creating the plan
		const level = await promptThinkingLevel(
			"Thinking level for planning:",
			PLAN_THINKING_LEVELS,
			planThinkingLevel,
			ctx,
		);
		if (level === null) return;
		planThinkingLevel = level;
		persistState();

		const planDir = path.join(ctx.cwd, ".pi", "plans", `${localIsoDate()}-${slug}`);
		const title = issue ? issue.title : toTitleCase(slug.replace(/-/g, " "));
		const created = ensurePlanPackage(planDir, title);
		setActivePlanDir(planDir, ctx);
		if (!planEnabled) {
			setPlan(true, ctx, { notify: false, captureCurrentTools: true });
		}

		const displayPlanDir = toDisplayPath(planDir, ctx.cwd);
		if (created.length === 0) {
			ctx.ui.notify(`Using existing plan package: ${displayPlanDir}.`, "info");
		} else {
			appendPlanEvent(planDir, {
				type: "created",
				timestamp: new Date().toISOString(),
				summary: title,
			});
			ctx.ui.notify(
				`Created ${displayPlanDir} (${created.join(", ")}) and enabled plan mode.`,
				"info",
			);
		}

		if (issue) {
			try {
				persistIssueBriefToPlanPackage(planDir, issue);
				ctx.ui.notify(`Loaded issue #${issue.number}: ${issue.title} (saved to ${ISSUE_BRIEF_FILE}).`, "info");
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Issue fetched, but failed to persist ${ISSUE_BRIEF_FILE}: ${reason}`, "warning");
			}
		}

		const kickoffPrompt = issue
			? `/skill:plan Start planning using this existing plan package directory: ${planDir}. Read ${ISSUE_BRIEF_FILE} first for the initial brief.\n\n${formatIssueBrief(issue)}`
			: userContext
				? `/skill:plan Start planning using this existing plan package directory: ${planDir}.\n\nUser planning context:\n${userContext}`
				: `/skill:plan Start planning using this existing plan package directory: ${planDir}`;
		queueUserPrompt(kickoffPrompt, ctx);
	}

	async function handlePlanCommand(args: string, ctx: ExtensionContext): Promise<void> {
		const trimmed = args.trim();
		if (!trimmed) {
			if (planEnabled) {
				// Already in plan mode — disable it
				setPlan(false, ctx);
				return;
			}

			// Not in plan mode — activate existing plan or start a new one
			const hasActivePlan = activePlanDir
				&& fs.existsSync(activePlanDir)
				&& fs.statSync(activePlanDir).isDirectory()
				&& requiredFilesMissing(activePlanDir).length === 0;

			if (hasActivePlan) {
				// Re-activate existing plan with thinking level prompt
				const level = await promptThinkingLevel(
					"Thinking level for planning:",
					PLAN_THINKING_LEVELS,
					planThinkingLevel,
					ctx,
				);
				if (level === null) return;
				planThinkingLevel = level;
				persistState();
				setPlan(true, ctx);
			} else {
				// No active plan — start a new one
				await handlePlanNew("", ctx);
			}
			return;
		}

		const [verbRaw, ...restParts] = trimmed.split(/\s+/);
		const verb = verbRaw.toLowerCase();
		const rest = restParts.join(" ").trim();

		if (verb === "on" || verb === "enable") {
			setPlan(true, ctx);
			return;
		}

		if (verb === "off" || verb === "disable") {
			setPlan(false, ctx);
			return;
		}

		if (verb === "toggle") {
			setPlan(!planEnabled, ctx);
			return;
		}

		if (verb === "status") {
			ctx.ui.notify(formatStatusSummary(ctx), "info");
			return;
		}

		if (verb === "mode") {
			if (rest) {
				const requested = rest.toLowerCase() as ThinkingLevel;
				if (!PLAN_THINKING_LEVELS.includes(requested)) {
					ctx.ui.notify("Usage: /plan mode [medium|high|xhigh]", "warning");
					return;
				}
				planThinkingLevel = requested;
				if (planEnabled) pi.setThinkingLevel(planThinkingLevel);
				persistState();
				ctx.ui.notify(`Plan thinking set to ${planThinkingLevel}.`, "info");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify(`Plan thinking: ${planThinkingLevel} (set with /plan mode [medium|high|xhigh])`, "info");
				return;
			}

			const currentIndex = PLAN_THINKING_LEVELS.indexOf(planThinkingLevel);
			const reordered = [
				...PLAN_THINKING_LEVELS.slice(currentIndex),
				...PLAN_THINKING_LEVELS.slice(0, currentIndex),
			];
			const choice = await ctx.ui.select(
				"Choose thinking level for planning:",
				reordered as string[],
			);
			if (!choice) return;

			const selected = choice as ThinkingLevel;
			if (!PLAN_THINKING_LEVELS.includes(selected)) return;

			planThinkingLevel = selected;
			if (planEnabled) pi.setThinkingLevel(planThinkingLevel);
			persistState();
			ctx.ui.notify(`Plan thinking set to ${planThinkingLevel}.`, "info");
			return;
		}

		if (verb === "clear") {
			setActivePlanDir(null, ctx);
			ctx.ui.notify("Cleared active plan package.", "info");
			return;
		}

		if (verb === "resume" || verb === "use") {
			let planDir: string | null = null;

			if (rest) {
				let fromArg = normalizeInputPath(rest, ctx.cwd);
				if (path.basename(fromArg) === "plan.md") fromArg = path.dirname(fromArg);
				planDir = fromArg;
			} else if (ctx.hasUI) {
				const available = listAvailablePlanDirs(ctx.cwd);
				if (available.length === 0) {
					ctx.ui.notify("No plan packages found in ./.pi/plans. Create one with /plan new [context].", "warning");
					return;
				}

				const labels = available.map((dir) => toDisplayPath(dir, ctx.cwd));
				const choice = await ctx.ui.select("Resume which plan?", labels);
				if (!choice) return;

				const selectedIndex = labels.indexOf(choice);
				if (selectedIndex < 0) return;
				planDir = available[selectedIndex] ?? null;
			} else {
				ctx.ui.notify("Usage: /plan resume <plan-dir>", "warning");
				return;
			}

			if (!planDir) return;

			if (!fs.existsSync(planDir) || !fs.statSync(planDir).isDirectory()) {
				ctx.ui.notify(`Not a directory: ${toDisplayPath(planDir, ctx.cwd)}`, "error");
				return;
			}

			const missing = requiredFilesMissing(planDir);
			if (missing.length > 0) {
				ctx.ui.notify(
					`Missing plan files in ${toDisplayPath(planDir, ctx.cwd)}: ${missing.join(", ")}`,
					"warning",
				);
				return;
			}

			setActivePlanDir(planDir, ctx);
			ctx.ui.notify(`Active plan set to ${toDisplayPath(planDir, ctx.cwd)}.`, "info");
			return;
		}

		if (verb === "review") {
			if (rest) {
				ctx.ui.notify("Usage: /plan review", "warning");
				return;
			}

			const planDir = activePlanDir;

			if (!planDir) {
				ctx.ui.notify("No active plan package. Use /plan new [context] or /plan resume <plan-dir> first.", "warning");
				return;
			}

			const missing = requiredFilesMissing(planDir);
			if (missing.length > 0) {
				ctx.ui.notify(
					`Active plan is missing required files: ${missing.join(", ")} (${toDisplayPath(planDir, ctx.cwd)}).`,
					"warning",
				);
				return;
			}

			if (!planEnabled) {
				setPlan(true, ctx, { notify: false, captureCurrentTools: true });
				ctx.ui.notify("Plan mode enabled for safe plan review.", "info");
			}

			const reviewPrompt = `/skill:plan review ${planDir}`;
			queueUserPrompt(reviewPrompt, ctx);
			ctx.ui.notify(`Queued plan review for ${toDisplayPath(planDir, ctx.cwd)}.`, "info");
			return;
		}

		if (verb === "new") {
			await handlePlanNew(rest, ctx);
			return;
		}

		usage(ctx);
	}

	pi.registerCommand("plan", {
		description: "Plan mode: start new plan, activate existing, or toggle off. Subcommands: new/resume/review/clear/status/mode/on/off",
		handler: async (args, ctx) => handlePlanCommand(args, ctx),
	});

	pi.registerCommand("build", {
		description: "Disable plan mode and implement from the active plan file (use --yolo to skip approval check, 'mode' to set thinking)",
		handler: async (args, ctx) => {
			const rawArgs = args.trim();

			const modeMatch = rawArgs.match(/^mode(?:\s+(\S+))?\s*$/i);
			if (modeMatch) {
				const requested = modeMatch[1]?.toLowerCase() as ThinkingLevel | undefined;
				if (requested) {
					if (!BUILD_THINKING_LEVELS.includes(requested)) {
						ctx.ui.notify(`Usage: /build mode [${BUILD_THINKING_LEVELS.join("|")}]`, "warning");
						return;
					}
					buildThinkingLevel = requested;
					persistState();
					ctx.ui.notify(`Build thinking set to ${buildThinkingLevel}.`, "info");
					return;
				}

				if (!ctx.hasUI) {
					ctx.ui.notify(`Build thinking: ${buildThinkingLevel} (set with /build mode [${BUILD_THINKING_LEVELS.join("|")}])`, "info");
					return;
				}

				const currentIndex = BUILD_THINKING_LEVELS.indexOf(buildThinkingLevel);
				const reordered = [
					...BUILD_THINKING_LEVELS.slice(currentIndex),
					...BUILD_THINKING_LEVELS.slice(0, currentIndex),
				];
				const choice = await ctx.ui.select(
					"Choose thinking level for build:",
					reordered as string[],
				);
				if (!choice) return;

				const selected = choice as ThinkingLevel;
				if (!BUILD_THINKING_LEVELS.includes(selected)) return;

				buildThinkingLevel = selected;
				persistState();
				ctx.ui.notify(`Build thinking set to ${buildThinkingLevel}.`, "info");
				return;
			}

			const yolo = /(^|\s)--yolo(?=\s|$)/.test(rawArgs);
			const pathArg = rawArgs.replace(/(^|\s)--yolo(?=\s|$)/g, " ").trim();
			let planDir = activePlanDir;

			if (pathArg) {
				let overridePlanDir = normalizeInputPath(pathArg, ctx.cwd);
				if (path.basename(overridePlanDir) === "plan.md") overridePlanDir = path.dirname(overridePlanDir);

				if (!fs.existsSync(overridePlanDir) || !fs.statSync(overridePlanDir).isDirectory()) {
					ctx.ui.notify(`Not a directory: ${toDisplayPath(overridePlanDir, ctx.cwd)}`, "error");
					return;
				}

				const planFileInOverride = path.join(overridePlanDir, "plan.md");
				if (!fs.existsSync(planFileInOverride) || !fs.statSync(planFileInOverride).isFile()) {
					ctx.ui.notify(`Missing plan.md in ${toDisplayPath(overridePlanDir, ctx.cwd)}.`, "warning");
					return;
				}

				setActivePlanDir(overridePlanDir, ctx);
				planDir = overridePlanDir;
			}

			if (!planDir) {
				ctx.ui.notify("No active plan package. Use /plan new [context] or /plan resume <plan-dir> first.", "warning");
				return;
			}

			const planFile = path.join(planDir, "plan.md");
			if (!fs.existsSync(planFile) || !fs.statSync(planFile).isFile()) {
				ctx.ui.notify(`Missing plan.md in ${toDisplayPath(planDir, ctx.cwd)}.`, "warning");
				return;
			}

			const changelogPath = path.join(planDir, "changelog.md");
			if (!yolo && !hasApprovedEntry(changelogPath)) {
				ctx.ui.notify(
					`Build blocked: no approval entry found in ${toDisplayPath(changelogPath, ctx.cwd)}. Approve the plan first, or run /build --yolo to proceed anyway.`,
					"warning",
				);
				return;
			}

			const level = await promptThinkingLevel(
				"Thinking level for build:",
				BUILD_THINKING_LEVELS,
				buildThinkingLevel,
				ctx,
			);
			if (level === null) return;
			buildThinkingLevel = level;
			persistState();

			if (planEnabled) {
				setPlan(false, ctx, { notify: false, captureCurrentTools: false });
			}

			pi.setThinkingLevel(buildThinkingLevel);

			const displayPlanFile = toDisplayPath(planFile, ctx.cwd);
			if (yolo) {
				ctx.ui.notify(`YOLO build enabled. Thinking: ${buildThinkingLevel}. Starting build using ${displayPlanFile}.`, "warning");
			} else {
				ctx.ui.notify(`Thinking: ${buildThinkingLevel}. Starting build using ${displayPlanFile}.`, "info");
			}

			if (planDir) {
				appendPlanEvent(planDir, {
					type: "build_started",
					timestamp: new Date().toISOString(),
					summary: yolo ? "YOLO build" : "build",
				});
			}

			const buildPrompt = `Start implementing now using ${planFile} as the guide. Read plan.md first, then execute the implementation steps in order. Keep code changes aligned with the plan and run the Validation Checklist before finishing. Do not modify plan package files unless explicitly asked.`;
			queueUserPrompt(buildPrompt, ctx);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => setPlan(!planEnabled, ctx),
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!planEnabled) return;

		if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
			const requestedPath = event.input.path;
			if (!activePlanDir) {
				return {
					block: true,
					reason:
						"Plan mode only allows edits in an active plan package. Set one with /plan new [context] or /plan resume <plan-dir>.",
				};
			}

			if (!canWriteToActivePlan(requestedPath, ctx.cwd)) {
				return {
					block: true,
					reason: `Plan mode only allows edits inside the active plan package (${toDisplayPath(activePlanDir, ctx.cwd)}).\nBlocked path: ${toDisplayPath(
						normalizeInputPath(requestedPath, ctx.cwd),
						ctx.cwd,
					)}`,
				};
			}
			return;
		}

		if (isToolCallEventType("bash", event)) {
			const command = event.input.command ?? "";
			if (!isSafeBashCommand(command)) {
				return {
					block: true,
					reason: `Plan mode only allows read-only bash commands.\nBlocked command: ${command}`,
				};
			}
		}
	});

	// Detect changelog.md writes and emit structured events to events.jsonl
	pi.on("tool_result", async (event, ctx) => {
		if (!planEnabled || !activePlanDir) return;
		if (event.toolName !== "edit" && event.toolName !== "write") return;

		const input = event.input as { path?: string } | undefined;
		if (!input?.path) return;

		const resolvedPath = resolvePathForContainment(input.path, activePlanDir);
		if (path.basename(resolvedPath) !== "changelog.md") return;
		if (!isWithinDirectory(resolvedPath, activePlanDir)) return;

		// Re-derive metadata from changelog and compare with events.jsonl
		const changelogMeta = derivePlanMetaFromChangelog(activePlanDir);
		const eventMeta = derivePlanMeta(readPlanEvents(activePlanDir));

		const timestamp = new Date().toISOString();

		// Emit new draft events
		if (changelogMeta.currentDraft > eventMeta.currentDraft) {
			appendPlanEvent(activePlanDir, {
				type: "draft",
				timestamp,
				version: changelogMeta.currentDraft,
				model: changelogMeta.lastModel ?? undefined,
			});
		}

		// Emit new review events
		if (changelogMeta.reviewCount > eventMeta.reviewCount) {
			appendPlanEvent(activePlanDir, {
				type: "review",
				timestamp,
				model: changelogMeta.lastModel ?? undefined,
			});
		}

		// Emit approval event
		if (changelogMeta.isApproved && !eventMeta.isApproved) {
			appendPlanEvent(activePlanDir, {
				type: "approved",
				timestamp,
			});
		}

		updateStatus(ctx);
	});

	pi.on("context", async (event) => {
		if (planEnabled) return;
		return {
			messages: event.messages.filter((message) => {
				const maybeCustom = message as { customType?: string };
				return maybeCustom.customType !== PLAN_CONTEXT_TYPE;
			}),
		};
	});

	pi.on("agent_start", async () => {
		planTurnsThisSession = 0;
	});

	pi.on("before_agent_start", async () => {
		if (!planEnabled) return;

		planTurnsThisSession++;

		const activePlanMessage = activePlanDir
			? `Active plan package: ${activePlanDir}`
			: "No active plan package selected yet. Ask the user to run /plan new [context] or /plan resume <dir>.";

		return {
			message: {
				customType: PLAN_CONTEXT_TYPE,
				content: `[PLAN MODE ACTIVE]\nTreat this turn as planning-only. Do not implement code changes.\nOnly edit files inside the active plan package (plan.md, feedback.md, changelog.md).\n${activePlanMessage}\n\nWhen planning, follow the plan skill workflow and keep plan state in plan.md, feedback.md, and changelog.md.`,
				display: false,
			},
		};
	});

	// Auto-resume when the agent hits a context limit during active planning
	pi.on("agent_end", async (_event, ctx) => {
		if (!planEnabled || !activePlanDir) return;

		// Only auto-resume if the agent did work this session
		if (planTurnsThisSession === 0) return;

		// Rate-limit auto-resume
		const now = Date.now();
		if (now - lastAutoResumeTime < AUTO_RESUME_COOLDOWN_MS) return;

		// Don't auto-resume forever
		if (planTurnsThisSession >= MAX_AUTO_RESUME_TURNS) {
			ctx.ui.notify(
				`Plan auto-resume limit reached (${MAX_AUTO_RESUME_TURNS} turns). Use /plan to re-activate.`,
				"info",
			);
			return;
		}

		lastAutoResumeTime = now;

		const meta = getPlanMeta(activePlanDir);
		const planFile = path.join(activePlanDir, "plan.md");
		const feedbackFile = path.join(activePlanDir, "feedback.md");

		let resumeMsg = `Plan mode context limit reached. Resume planning for ${activePlanDir}.`;
		resumeMsg += ` Re-read ${planFile} and ${feedbackFile} for current state.`;

		if (meta.currentDraft > 0) {
			resumeMsg += ` Currently on Draft ${meta.currentDraft}.`;
		}
		if (meta.lastEvent === "review") {
			resumeMsg += ` Last action was a review — check feedback.md for findings to discuss with the user.`;
		}

		pi.sendUserMessage(resumeMsg);
	});

	pi.on("input", async (event, ctx) => {
		const planPathArg = parsePlanReviewPath(event.text);
		if (!planPathArg) return;

		let planDir = normalizeInputPath(planPathArg, ctx.cwd);
		if (path.basename(planDir) === "plan.md") planDir = path.dirname(planDir);

		if (!fs.existsSync(planDir) || !fs.statSync(planDir).isDirectory()) return;
		if (requiredFilesMissing(planDir).length > 0) return;

		setActivePlanDir(planDir, ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		let restoredState: PlanState | null = null;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;
			// Support both new and legacy state entry names
			if (entry.customType !== STATE_ENTRY && entry.customType !== LEGACY_STATE_ENTRY) continue;
			const data = entry.data as Partial<PlanState> | undefined;
			if (!data) continue;

			const restoredPlanThinking =
				typeof data.planThinkingLevel === "string" &&
				PLAN_THINKING_LEVELS.includes(data.planThinkingLevel as ThinkingLevel)
					? (data.planThinkingLevel as ThinkingLevel)
					: "high";
			const restoredBuildThinking =
				typeof data.buildThinkingLevel === "string" &&
				BUILD_THINKING_LEVELS.includes(data.buildThinkingLevel as ThinkingLevel)
					? (data.buildThinkingLevel as ThinkingLevel)
					: "medium";
			const restoredPreviousThinking =
				typeof data.previousThinkingLevel === "string"
					? (data.previousThinkingLevel as ThinkingLevel)
					: null;

			restoredState = {
				enabled: Boolean(data.enabled),
				activePlanDir: typeof data.activePlanDir === "string" ? data.activePlanDir : null,
				previousTools: Array.isArray(data.previousTools)
					? data.previousTools.filter((tool): tool is string => typeof tool === "string")
					: [],
				planThinkingLevel: restoredPlanThinking,
				buildThinkingLevel: restoredBuildThinking,
				previousThinkingLevel: restoredPreviousThinking,
			};
		}

		if (restoredState) {
			planEnabled = restoredState.enabled;
			activePlanDir = restoredState.activePlanDir ? path.resolve(restoredState.activePlanDir) : null;
			previousTools = restoredState.previousTools;
			planThinkingLevel = restoredState.planThinkingLevel;
			buildThinkingLevel = restoredState.buildThinkingLevel;
			previousThinkingLevel = restoredState.previousThinkingLevel;
		}

		if (pi.getFlag("plan") === true) planEnabled = true;

		if (planEnabled) {
			if (previousTools.length === 0) previousTools = pi.getActiveTools();
			setPlan(true, ctx, { notify: false, captureCurrentTools: false });
		} else {
			updateStatus(ctx);
		}
	});
}
