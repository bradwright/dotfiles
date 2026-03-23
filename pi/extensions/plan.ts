import * as fs from "node:fs";
import * as path from "node:path";

import { execFileSync } from "node:child_process";

import { getAgentDir, type ExtensionAPI, type ExtensionContext, type Theme } from "@mariozechner/pi-coding-agent";
import { type Focusable, Key, matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import {
	appendJsonlEvent,
	hasApprovedEntry,
	isWithinDirectory,
	localIsoDate,
	normalizeInputPath,
	readJsonlEvents,
	requiredFilesMissing,
	resolvePathForContainment,
	slugify,
	toDisplayPath,
	toTitleCase,
	truncateText,
} from "./lib/shared.js";

const PLAN_TOOLS = ["read", "bash", "grep", "find", "ls", "edit", "write", "subagent"] as const;
const FALLBACK_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
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
	return readJsonlEvents<PlanEvent>(path.join(planDir, EVENTS_FILE));
}

function appendPlanEvent(planDir: string, event: PlanEvent): void {
	appendJsonlEvent<PlanEvent>(path.join(planDir, EVENTS_FILE), event);
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

			// Match "- Draft N — YYYY-MM-DD: ..." (model suffix optional)
			const draftMatch = trimmed.match(/^-\s+Draft\s+(\d+)\s+[—-]\s+\d{4}-\d{2}-\d{2}(?:,\s+([^:]+?))?:/i);
			if (draftMatch) {
				currentDraft = parseInt(draftMatch[1], 10);
				if (draftMatch[2] && draftMatch[2].trim().length > 0) lastModel = draftMatch[2].trim();
				lastEvent = "draft";
				continue;
			}

			// Match "- Review — YYYY-MM-DD: ..." (model suffix optional)
			const reviewMatch = trimmed.match(/^-\s+Review\s+[—-]\s+\d{4}-\d{2}-\d{2}(?:,\s+([^:]+?))?:/i);
			if (reviewMatch) {
				reviewCount++;
				if (reviewMatch[1] && reviewMatch[1].trim().length > 0) lastModel = reviewMatch[1].trim();
				lastEvent = "review";
				continue;
			}

			// Match "- Edit — YYYY-MM-DD: ..." (model suffix optional)
			const editMatch = trimmed.match(/^-\s+Edit\s+[—-]\s+\d{4}-\d{2}-\d{2}(?:,\s+([^:]+?))?:/i);
			if (editMatch) {
				if (editMatch[1] && editMatch[1].trim().length > 0) lastModel = editMatch[1].trim();
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

/** Analyze plan.md complexity and recommend single-agent vs multi-agent build. */
function recommendBuildMode(planDir: string): "multi" | "single" {
	const planPath = path.join(planDir, "plan.md");
	if (!fs.existsSync(planPath)) return "single";

	try {
		const content = fs.readFileSync(planPath, "utf8");
		const lines = content.split("\n");

		let inImplementation = false;
		let inFiles = false;
		let stepCount = 0;
		let fileCount = 0;

		for (const line of lines) {
			if (/^## Implementation Plan/i.test(line)) {
				inImplementation = true;
				inFiles = false;
				continue;
			}
			if (/^## Files and Components to Touch/i.test(line)) {
				inFiles = true;
				inImplementation = false;
				continue;
			}
			if (/^## /.test(line)) {
				inImplementation = false;
				inFiles = false;
				continue;
			}

			if (inImplementation && /^\s*\d+\./.test(line)) {
				stepCount++;
			}
			if (inFiles && /^\s*-\s+/.test(line)) {
				fileCount++;
			}
		}

		return stepCount >= 4 && fileCount >= 5 ? "multi" : "single";
	} catch {
		return "single";
	}
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

function parsePlanReviewPath(input: string): string | null {
	const match = input.trim().match(/^\/skill:plan-methodology\s+review\s+(.+)$/i);
	if (!match) return null;
	return match[1].trim();
}

function parseGitHubIssueUrl(input: string): GitHubIssueRef | null {
	const value = input.trim().replace(/^["']|["']$/g, "");
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

// ---------------------------------------------------------------------------
// Read-only scrollable text viewer overlay
// ---------------------------------------------------------------------------

/** Syntax-highlight markdown via bat. Falls back to plain text if bat isn't available. */
function highlightMarkdown(content: string): string[] {
	try {
		const highlighted = execFileSync("bat", [
			"--language=md",
			"--color=always",
			"--style=plain",
			"--paging=never",
			"--wrap=never",
		], {
			input: content,
			encoding: "utf8",
			timeout: 3000,
			maxBuffer: 5 * 1024 * 1024,
		});
		return highlighted.split("\n");
	} catch {
		return content.split("\n");
	}
}

class PlanViewerComponent implements Focusable {
	focused = false;
	private scrollOffset = 0;
	private wrappedLines: string[] = [];
	private viewportHeight = 0;
	private title: string;
	private highlightedLines: string[];

	constructor(
		private theme: Theme,
		private done: () => void,
		title: string,
		content: string,
	) {
		this.title = title;
		this.highlightedLines = highlightMarkdown(content);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.done();
			return;
		}

		const maxScroll = Math.max(0, this.wrappedLines.length - this.viewportHeight);

		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
		} else if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
		} else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.viewportHeight);
		} else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d")) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + this.viewportHeight);
		} else if (matchesKey(data, "home") || matchesKey(data, "g")) {
			this.scrollOffset = 0;
		} else if (matchesKey(data, "end") || matchesKey(data, "shift+g")) {
			this.scrollOffset = maxScroll;
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerW = Math.max(20, width - 4);

		// Wrap pre-highlighted lines for current width
		this.wrappedLines = [];
		for (const line of this.highlightedLines) {
			if (visibleWidth(line) <= innerW) {
				this.wrappedLines.push(line);
			} else {
				const wrapped = wrapTextWithAnsi(line, innerW);
				for (const wl of wrapped) {
					this.wrappedLines.push(wl);
				}
			}
		}

		const lines: string[] = [];

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};

		const row = (content: string) =>
			th.fg("border", "│") + " " + pad(content, innerW) + " " + th.fg("border", "│");

		// Header
		lines.push(th.fg("border", `╭${"─".repeat(innerW + 2)}╮`));
		lines.push(row(th.fg("accent", `📋 ${this.title}`)));
		lines.push(th.fg("border", `├${"─".repeat(innerW + 2)}┤`));

		// Content area — leave room for header (3) + footer (2)
		this.viewportHeight = Math.max(5, 30);
		const maxScroll = Math.max(0, this.wrappedLines.length - this.viewportHeight);
		if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;

		const visible = this.wrappedLines.slice(this.scrollOffset, this.scrollOffset + this.viewportHeight);
		for (const line of visible) {
			lines.push(row(truncateToWidth(line, innerW)));
		}

		// Pad if content is shorter than viewport
		for (let i = visible.length; i < this.viewportHeight; i++) {
			lines.push(row(""));
		}

		// Footer with scroll position
		const total = this.wrappedLines.length;
		const pos = total > 0
			? `${this.scrollOffset + 1}–${Math.min(this.scrollOffset + this.viewportHeight, total)}/${total}`
			: "empty";
		const hint = th.fg("dim", `↑↓/jk scroll • PgUp/PgDn • g/G top/bottom • q/Esc close`);
		const posLabel = th.fg("dim", pos);

		lines.push(th.fg("border", `├${"─".repeat(innerW + 2)}┤`));
		lines.push(row(`${hint}  ${posLabel}`));
		lines.push(th.fg("border", `╰${"─".repeat(innerW + 2)}╯`));

		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
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

	function emitStateChanged(): void {
		pi.events.emit("plan:state-changed", { enabled: planEnabled, activePlanDir });
	}

	function planLabel(): string {
		if (!activePlanDir) return "no plan";
		return path.basename(activePlanDir);
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		// Never use the status bar — the widget handles everything
		ctx.ui.setStatus(STATUS_KEY, undefined);

		if (!planEnabled) {
			ctx.ui.setWidget(STATUS_KEY, undefined);
			return;
		}

		ctx.ui.setWidget(STATUS_KEY, (_tui, theme) => {
			const parts: string[] = [];

			if (!activePlanDir || !fs.existsSync(activePlanDir)) {
				// Plan mode on but no plan loaded yet
				parts.push(theme.fg("warning", "📋 DRAFT"));
				parts.push(theme.fg("muted", planLabel()));
				parts.push(theme.fg("dim", `thinking: ${pi.getThinkingLevel()}`));
				return new Text(parts.join(theme.fg("dim", " │ ")), 0, 0);
			}

			const meta = getPlanMeta(activePlanDir!);
			const feedbackCount = countFeedbackItems(activePlanDir!);
			const readiness = computeReadiness(activePlanDir!);

			// Phase indicator
			if (meta.isApproved) {
				parts.push(theme.fg("success", "📋 APPROVED"));
			} else if (meta.currentDraft > 0) {
				parts.push(theme.fg("warning", `📋 DRAFT ${meta.currentDraft}`));
			} else {
				parts.push(theme.fg("warning", "📋 DRAFT"));
			}

			// Plan label (directory name)
			parts.push(theme.fg("muted", planLabel()));

			// Review count
			if (meta.reviewCount > 0) {
				parts.push(theme.fg("muted", `${meta.reviewCount} review${meta.reviewCount > 1 ? "s" : ""}`));
			}

			// Feedback items
			if (feedbackCount > 0) {
				parts.push(theme.fg("warning", `${feedbackCount} feedback`));
			}

			// Readiness score
			const readinessColor = readiness.score === readiness.total ? "success"
				: readiness.score >= readiness.total - 1 ? "warning"
				: "muted";
			parts.push(theme.fg(readinessColor as Parameters<typeof theme.fg>[0], `${readiness.score}/${readiness.total} ready`));

			// Thinking level
			parts.push(theme.fg("dim", `thinking: ${pi.getThinkingLevel()}`));

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
		emitStateChanged();
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
		emitStateChanged();
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

	function resolveProjectAgentModel(cwd: string, agentName: string): string | null {
		const agentPath = path.join(cwd, ".pi", "agents", `${agentName}.md`);
		if (!fs.existsSync(agentPath)) return null;

		try {
			const content = fs.readFileSync(agentPath, "utf8");
			const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
			if (!frontmatter) return null;
			const modelMatch = frontmatter[1].match(/^model:\s*(.+)$/m);
			if (!modelMatch) return null;
			const model = modelMatch[1].trim();
			return model.length > 0 ? model : null;
		} catch {
			return null;
		}
	}

	function listAvailableAgentNames(cwd: string): string[] {
		const names = new Set<string>();
		const roots = [
			path.join(cwd, ".pi", "agents"),
			path.join(getAgentDir(), "agents"),
		];

		for (const root of roots) {
			if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
			for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
				if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
				names.add(path.basename(entry.name, ".md"));
			}
		}

		return Array.from(names).sort();
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
			? `/skill:plan-methodology Start planning using this existing plan package directory: ${planDir}. Read ${ISSUE_BRIEF_FILE} first for the initial brief.\n\n${formatIssueBrief(issue)}`
			: userContext
				? `/skill:plan-methodology Start planning using this existing plan package directory: ${planDir}.\n\nUser planning context:\n${userContext}`
				: `/skill:plan-methodology Start planning using this existing plan package directory: ${planDir}`;
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
				// No active plan — offer to resume an existing one or start new
				const available = listAvailablePlanDirs(ctx.cwd);
				if (available.length > 0 && ctx.hasUI) {
					const action = await ctx.ui.select("No active plan.", [
						"Resume existing plan",
						"Start new plan",
					]);
					if (!action) return;

					if (action === "Resume existing plan") {
						const labels = available.map((dir) => toDisplayPath(dir, ctx.cwd));
						const choice = await ctx.ui.select("Resume which plan?", labels);
						if (!choice) return;
						const selectedIndex = labels.indexOf(choice);
						if (selectedIndex < 0) return;
						const planDir = available[selectedIndex];
						if (!planDir) return;
						setActivePlanDir(planDir, ctx);

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
						return;
					}
				}

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

			if (!planEnabled) {
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
				ctx.ui.notify(`Active plan set to ${toDisplayPath(planDir, ctx.cwd)}.`, "info");
			}
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

			// Check if pi-subagents is installed (provides /run command)
			const allTools = new Set(pi.getAllTools().map((t) => t.name));
			if (allTools.has("subagent")) {
				// Pick reviewer agent from currently available agents.
				const preferredReviewAgents = ["plan-reviewer", "reviewer", "scout"];
				const availableAgents = new Set(listAvailableAgentNames(ctx.cwd));
				const reviewAgents = preferredReviewAgents.filter((name) => availableAgents.has(name));
				if (reviewAgents.length === 0) {
					ctx.ui.notify(
						"No review agents found (expected one of: plan-reviewer, reviewer, scout). Falling back to in-session review.",
						"warning",
					);
					const reviewPrompt = `/skill:plan-methodology review ${planDir}`;
					queueUserPrompt(reviewPrompt, ctx);
					return;
				}
				const agentChoice = await ctx.ui.select("Review agent:", reviewAgents);
				if (!agentChoice) return;

				// Pick thinking level
				const REVIEW_THINKING: ThinkingLevel[] = ["medium", "high", "low"];
				const thinkingChoice = await promptThinkingLevel(
					"Thinking level for review:",
					REVIEW_THINKING,
					"medium",
					ctx,
				);
				if (thinkingChoice === null) return;

				// Build the /run command — pi-subagents handles execution,
				// progress display, and injects results into conversation.
				// /run supports [model=...] inline config (not [thinking=...]).
				let inlineConfig = "";
				if (thinkingChoice !== "medium") {
					const agentModel = resolveProjectAgentModel(ctx.cwd, agentChoice);
					if (agentModel) {
						inlineConfig = `[model=${agentModel}:${thinkingChoice}]`;
					} else {
						ctx.ui.notify(
							`Could not resolve model for ${agentChoice}; using agent default thinking.`,
							"warning",
						);
					}
				}
				const task = `Review the plan package at ${planDir}. Read plan.md and feedback.md, evaluate against the readiness criteria, then write findings to feedback.md and a Review entry to changelog.md.`;
				queueUserPrompt(`/run ${agentChoice}${inlineConfig} ${task}`, ctx);
				ctx.ui.notify(`Starting ${agentChoice} review of ${toDisplayPath(planDir, ctx.cwd)}...`, "info");
			} else {
				// Fallback: run review in-session via the skill
				const reviewPrompt = `/skill:plan-methodology review ${planDir}`;
				queueUserPrompt(reviewPrompt, ctx);
				ctx.ui.notify(`Queued plan review for ${toDisplayPath(planDir, ctx.cwd)}.`, "info");
			}
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

			// Build mode selection: single-agent vs multi-agent
			const recommended = recommendBuildMode(planDir);
			const modeOptions = recommended === "multi"
				? ["Multi-agent (/build-agents) — recommended", "Single agent"]
				: ["Single agent — recommended", "Multi-agent (/build-agents)"];
			const modeChoice = await ctx.ui.select("Build mode:", modeOptions);
			if (!modeChoice) return;

			if (modeChoice.includes("Multi-agent")) {
				appendPlanEvent(planDir, {
					type: "build_started",
					timestamp: new Date().toISOString(),
					summary: "multi-agent build",
				});
				queueUserPrompt("/build-agents " + planDir, ctx);
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

	pi.registerShortcut(Key.ctrlShift("p"), {
		description: "View plan.md in overlay",
		handler: async (ctx) => {
			if (!planEnabled || !activePlanDir) {
				ctx.ui.notify("No active plan. Use /plan to start or resume one.", "info");
				return;
			}

			const planFile = path.join(activePlanDir, "plan.md");
			if (!fs.existsSync(planFile)) {
				ctx.ui.notify(`plan.md not found in ${toDisplayPath(activePlanDir, ctx.cwd)}`, "warning");
				return;
			}

			let content: string;
			try {
				content = fs.readFileSync(planFile, "utf8");
			} catch {
				ctx.ui.notify("Failed to read plan.md", "error");
				return;
			}

			const title = path.basename(activePlanDir);
			await ctx.ui.custom<void>(
				(_tui, theme, _kb, done) => new PlanViewerComponent(theme, done, title, content),
				{
					overlay: true,
					overlayOptions: {
						width: "80%",
						maxHeight: "80%",
						anchor: "center",
					},
				},
			);
		},
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
				content: `[PLAN MODE ACTIVE]\nTreat this turn as planning-only. Do not implement code changes.\nOnly edit files inside the active plan package (plan.md, feedback.md, changelog.md).\n${activePlanMessage}\n\nWhen planning, follow the plan-methodology skill workflow and keep plan state in plan.md, feedback.md, and changelog.md.`,
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

		// Emit state-changed so plan-guards.ts syncs on session restore
		emitStateChanged();
	});
}
