import * as fs from "node:fs";
import * as path from "node:path";

import { type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";

import {
	localIsoDate,
	normalizeInputPath,
	requiredFilesMissing,
	slugify,
	toDisplayPath,
	toTitleCase,
	truncateText,
} from "./lib/shared.js";

const ISSUE_BRIEF_FILE = "brief.md";
const STATE_ENTRY = "plan-state";
const LEGACY_STATE_ENTRY = "plan-mode-state";
const STATUS_KEY = "plan";

const PLAN_USAGE =
	"/plan [brief] | new [brief|github-url] | use <plan-dir> | resume [plan-dir] | review [--model <id>] | status | clear/exit";

const GITHUB_ISSUE_FETCH_TIMEOUT_MS = 15000;
const GITHUB_ISSUE_BODY_MAX_CHARS = 12000;

type PlanState = {
	activePlanDir: string | null;
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

function planTemplate(title: string): string {
	return [
		`# Plan: ${title}`,
		"",
		"## Goal",
		"",
		"## Must-Haves",
		"<!-- Observable truths: what must be TRUE from the user's perspective -->",
		"<!-- Required artifacts: specific files that must exist -->",
		"<!-- Key wiring: critical connections between artifacts -->",
		"",
		"## Context and Constraints",
		"",
		"## Files and Components to Touch",
		"",
		"## Implementation Plan",
		"1.",
		"",
		"## Risks / Edge Cases",
		"",
		"## Validation Checklist",
		"",
		"## Open Questions",
		"",
	].join("\n");
}

function feedbackTemplate(): string {
	return "# Feedback\n\n";
}

function changelogTemplate(): string {
	return "# Changelog\n\n";
}

function contextTemplate(): string {
	return "# Context\n\n";
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

	const contextPath = path.join(planDir, "context.md");
	if (!fs.existsSync(contextPath)) {
		fs.writeFileSync(contextPath, contextTemplate());
		created.push("context.md");
	}

	return created;
}

function listAvailablePlanDirs(cwd: string): string[] {
	const plansRoot = path.join(cwd, ".pi", "plans");
	if (!fs.existsSync(plansRoot) || !fs.statSync(plansRoot).isDirectory()) return [];

	return fs
		.readdirSync(plansRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(plansRoot, entry.name))
		.filter((dir) => requiredFilesMissing(dir).length === 0)
		.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
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

export default function plan(pi: ExtensionAPI) {
	let activePlanDir: string | null = null;

	function persistState(): void {
		pi.appendEntry<PlanState>(STATE_ENTRY, {
			activePlanDir,
		});
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (!activePlanDir) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		ctx.ui.setStatus(STATUS_KEY, `📋 ${path.basename(activePlanDir)}`);
	}

	function setActivePlanDir(nextPlanDir: string | null, ctx: ExtensionContext): void {
		activePlanDir = nextPlanDir ? path.resolve(nextPlanDir) : null;
		persistState();
		updateStatus(ctx);
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

		if (!slugInput && ctx.hasUI) {
			const description = (await ctx.ui.input("What do you want to plan?", "describe the feature or task"))?.trim() ?? "";
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

		const planDir = path.join(ctx.cwd, ".pi", "plans", `${localIsoDate()}-${slug}`);
		const title = issue ? issue.title : toTitleCase(slug.replace(/-/g, " "));
		const created = ensurePlanPackage(planDir, title);
		setActivePlanDir(planDir, ctx);

		const displayPlanDir = toDisplayPath(planDir, ctx.cwd);
		if (created.length === 0) {
			ctx.ui.notify(`Using existing plan package: ${displayPlanDir}.`, "info");
		} else {
			ctx.ui.notify(`Created ${displayPlanDir} (${created.join(", ")}).`, "info");
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

	async function choosePlanDirViaUI(ctx: ExtensionContext): Promise<string | null> {
		if (!ctx.hasUI) return null;
		const available = listAvailablePlanDirs(ctx.cwd);
		if (available.length === 0) return null;

		const labels = available.map((dir) => toDisplayPath(dir, ctx.cwd));
		const choice = await ctx.ui.select("Use which plan?", labels);
		if (!choice) return null;
		const index = labels.indexOf(choice);
		if (index < 0) return null;
		return available[index] ?? null;
	}

	function resolvePlanDirFromArg(arg: string, ctx: ExtensionContext): string {
		let planDir = normalizeInputPath(arg, ctx.cwd);
		if (path.basename(planDir) === "plan.md") planDir = path.dirname(planDir);
		return planDir;
	}

	async function handlePlanUse(rest: string, ctx: ExtensionContext): Promise<void> {
		let planDir: string | null = null;
		if (rest) {
			planDir = resolvePlanDirFromArg(rest, ctx);
		} else {
			if (!ctx.hasUI) {
				ctx.ui.notify("Usage: /plan use <plan-dir>", "warning");
				return;
			}

			planDir = await choosePlanDirViaUI(ctx);
			if (!planDir) {
				ctx.ui.notify("No plan packages found. Create one with /plan new [context].", "warning");
				return;
			}
		}

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
	}

	function buildPlanStatus(ctx: ExtensionContext): string {
		if (!activePlanDir) return "Active plan: (none)";
		const missing = requiredFilesMissing(activePlanDir);
		const lines = [
			`Active plan: ${toDisplayPath(activePlanDir, ctx.cwd)}`,
			`Missing required files: ${missing.length === 0 ? "none" : missing.join(", ")}`,
		];

		const optionalFiles = ["context.md", ISSUE_BRIEF_FILE];
		for (const file of optionalFiles) {
			const exists = fs.existsSync(path.join(activePlanDir, file));
			lines.push(`${file}: ${exists ? "present" : "missing"}`);
		}

		return lines.join("\n");
	}

	type ReviewArgs = { modelOverride: string | null; steering: string | null };

	function parsePlanReviewArgs(rest: string): ReviewArgs {
		const trimmed = rest.trim();
		if (!trimmed) return { modelOverride: null, steering: null };

		const flagMatch = trimmed.match(/^(?:--model|-m)\s+(\S+)(?:\s+([\s\S]+))?$/i);
		if (flagMatch) {
			const modelOverride = flagMatch[1] ?? null;
			const steering = flagMatch[2]?.trim() || null;
			return { modelOverride, steering };
		}

		// Backward compatibility: `/plan review <model>`
		return { modelOverride: trimmed, steering: null };
	}

	async function handlePlanReview(rest: string, ctx: ExtensionContext): Promise<void> {
		if (!activePlanDir) {
			ctx.ui.notify("No active plan package. Use /plan new [context] or /plan use <plan-dir> first.", "warning");
			return;
		}

		const missing = requiredFilesMissing(activePlanDir);
		if (missing.length > 0) {
			ctx.ui.notify(
				`Active plan is missing required files: ${missing.join(", ")} (${toDisplayPath(activePlanDir, ctx.cwd)}).`,
				"warning",
			);
			return;
		}

		const reviewArgs = parsePlanReviewArgs(rest);
		const modelInstruction = reviewArgs.modelOverride
			? `\nUse this model for the plan-reviewer Agent call: ${reviewArgs.modelOverride}.`
			: "";
		const steeringInstruction = reviewArgs.steering
			? `\nReview steering: ${reviewArgs.steering}`
			: "";

		queueUserPrompt(`/skill:plan-methodology review ${activePlanDir}${modelInstruction}${steeringInstruction}`, ctx);
		ctx.ui.notify(`Queued plan review for ${toDisplayPath(activePlanDir, ctx.cwd)}.`, "info");
	}

	async function handlePlanCommand(args: string, ctx: ExtensionContext): Promise<void> {
		const trimmed = args.trim();
		if (!trimmed) {
			if (activePlanDir) {
				queueUserPrompt(`/skill:plan-methodology Start planning using this existing plan package directory: ${activePlanDir}`, ctx);
				ctx.ui.notify(`Queued planning flow for ${toDisplayPath(activePlanDir, ctx.cwd)}.`, "info");
				return;
			}
			await handlePlanNew("", ctx);
			return;
		}

		const [verbRaw, ...restParts] = trimmed.split(/\s+/);
		const verb = verbRaw.toLowerCase();
		const rest = restParts.join(" ").trim();

		if (verb === "new") {
			await handlePlanNew(rest, ctx);
			return;
		}

		if (verb === "use" || verb === "resume") {
			await handlePlanUse(rest, ctx);
			return;
		}

		if (verb === "review") {
			await handlePlanReview(rest, ctx);
			return;
		}

		if (verb === "status") {
			ctx.ui.notify(buildPlanStatus(ctx), "info");
			return;
		}

		if (verb === "clear" || verb === "exit") {
			setActivePlanDir(null, ctx);
			ctx.ui.notify("Cleared active plan package.", "info");
			return;
		}

		// Treat anything else as inline planning context for /plan
		await handlePlanNew(trimmed, ctx);
	}

	pi.registerCommand("plan", {
		description: "Plan orchestration: new/use/resume/review/status/clear/exit",
		handler: async (args, ctx) => handlePlanCommand(args, ctx),
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
			if (entry.customType !== STATE_ENTRY && entry.customType !== LEGACY_STATE_ENTRY) continue;
			const data = entry.data as Partial<PlanState & { activePlanDir?: string | null }> | undefined;
			if (!data) continue;
			restoredState = {
				activePlanDir: typeof data.activePlanDir === "string" ? data.activePlanDir : null,
			};
		}

		if (restoredState) {
			activePlanDir = restoredState.activePlanDir ? path.resolve(restoredState.activePlanDir) : null;
		}

		updateStatus(ctx);
	});
}
