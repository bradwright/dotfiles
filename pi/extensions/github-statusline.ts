import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type RepoInfo = {
	alias: string;
	host: string;
};

type PullRequestInfo = {
	number: number;
	url: string;
};

type FooterMode = "minimal" | "focus" | "debug";
type UsageModeEntry = { mode: FooterMode };
type Segment = { text: string; color: string; linkUrl?: string };

const COMMAND_TIMEOUT_MS = 5000;
const PR_CACHE_TTL_MS = 30000;
const USAGE_MODE_ENTRY = "github-statusline-usage-mode";

function parseGitHubRemote(remoteUrl: string): RepoInfo | null {
	const cleaned = remoteUrl.trim().replace(/\.git$/, "").replace(/\/$/, "");
	const patterns = [
		/^git@([^:]+):([^/]+\/[^/]+)$/,
		/^ssh:\/\/git@([^/]+)\/([^/]+\/[^/]+)$/,
		/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)$/,
	] as const;

	for (const pattern of patterns) {
		const match = cleaned.match(pattern);
		if (!match) continue;

		const host = match[1];
		const alias = match[2];
		if (!host.toLowerCase().includes("github")) continue;

		return { alias, host };
	}

	return null;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function toHomeRelativePath(path: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

function isFooterMode(value: string): value is FooterMode {
	return value === "minimal" || value === "focus" || value === "debug";
}

function truncateSegments(segments: Segment[], width: number): Segment[] {
	if (width <= 0) return [];

	const totalLength = segments.reduce((sum, segment) => sum + segment.text.length, 0);
	if (totalLength <= width) return segments;
	if (width === 1) return [{ text: "…", color: "dim" }];

	let remaining = width - 1;
	const truncated: Segment[] = [];

	for (const segment of segments) {
		if (remaining <= 0) break;
		const chunk = segment.text.slice(0, remaining);
		if (!chunk) continue;
		truncated.push({ ...segment, text: chunk });
		remaining -= chunk.length;
	}

	truncated.push({ text: "…", color: "dim" });
	return truncated;
}

function withHyperlink(url: string, text: string): string {
	return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

function renderSegments(segments: Segment[], theme: { fg: (color: string, text: string) => string }): string {
	let output = "";
	for (const segment of segments) {
		if (!segment.text) continue;
		const colored = theme.fg(segment.color, segment.text);
		output += segment.linkUrl ? withHyperlink(segment.linkUrl, colored) : colored;
	}
	return output;
}

function thinkingColor(level: string | null): string {
	if (level === "off") return "thinkingOff";
	if (level === "minimal") return "thinkingMinimal";
	if (level === "low") return "thinkingLow";
	if (level === "medium") return "thinkingMedium";
	if (level === "high") return "thinkingHigh";
	if (level === "xhigh") return "thinkingXhigh";
	return "dim";
}

function contextColor(percent: number | null | undefined): string {
	if (percent === null || percent === undefined) return "dim";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "dim";
}

export default function githubStatusline(pi: ExtensionAPI) {
	let repoInfo: RepoInfo | null = null;
	let branch: string | null = null;
	let pullRequest: PullRequestInfo | null = null;
	let refreshVersion = 0;
	let footerMode: FooterMode = "minimal";
	let requestFooterRender: (() => void) | null = null;
	let prCache: { key: string; result: PullRequestInfo | null; timestamp: number } | null = null;

	const loadRepoInfo = async (): Promise<RepoInfo | null> => {
		try {
			const result = await pi.exec("git", ["config", "--get", "remote.origin.url"], {
				timeout: COMMAND_TIMEOUT_MS,
			});
			if (result.code !== 0 || !result.stdout.trim()) return null;
			return parseGitHubRemote(result.stdout);
		} catch {
			return null;
		}
	};

	const loadOpenPullRequest = async (
		info: RepoInfo,
		currentBranch: string,
	): Promise<PullRequestInfo | null> => {
		if (!currentBranch || currentBranch === "detached") return null;

		const cacheKey = `${info.host}/${info.alias}#${currentBranch}`;
		if (prCache && prCache.key === cacheKey && Date.now() - prCache.timestamp < PR_CACHE_TTL_MS) {
			return prCache.result;
		}

		const ghRepo = info.host === "github.com" ? info.alias : `${info.host}/${info.alias}`;

		try {
			const result = await pi.exec(
				"gh",
				[
					"pr",
					"list",
					"--repo",
					ghRepo,
					"--head",
					currentBranch,
					"--state",
					"open",
					"--json",
					"number,url",
					"--limit",
					"1",
				],
				{ timeout: COMMAND_TIMEOUT_MS },
			);

			if (result.code !== 0 || !result.stdout.trim()) {
				prCache = { key: cacheKey, result: null, timestamp: Date.now() };
				return null;
			}

			const prs = JSON.parse(result.stdout) as Array<{ number: number; url: string }>;
			const pr = prs[0];
			if (!pr || typeof pr.number !== "number" || typeof pr.url !== "string") {
				prCache = { key: cacheKey, result: null, timestamp: Date.now() };
				return null;
			}

			const parsed = { number: pr.number, url: pr.url };
			prCache = { key: cacheKey, result: parsed, timestamp: Date.now() };
			return parsed;
		} catch {
			prCache = { key: cacheKey, result: null, timestamp: Date.now() };
			return null;
		}
	};

	const refresh = async (nextBranch: string | null, requestRender: () => void): Promise<void> => {
		const run = ++refreshVersion;
		branch = nextBranch;
		pullRequest = null;

		if (!branch) {
			repoInfo = null;
			requestRender();
			return;
		}

		requestRender();

		const nextRepoInfo = await loadRepoInfo();
		if (run !== refreshVersion) return;

		repoInfo = nextRepoInfo;
		if (!repoInfo) {
			requestRender();
			return;
		}

		const nextPr = await loadOpenPullRequest(repoInfo, branch);
		if (run !== refreshVersion) return;

		pullRequest = nextPr;
		requestRender();
	};

	pi.registerCommand("toggle-usage", {
		description: "Set usage display mode: minimal | focus | debug | cycle",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			const nextMode =
				value === "" || value === "cycle"
					? footerMode === "minimal"
						? "focus"
						: footerMode === "focus"
							? "debug"
							: "minimal"
					: isFooterMode(value)
						? value
						: null;

			if (!nextMode) {
				ctx.ui.notify("Usage: /toggle-usage [minimal|focus|debug|cycle]", "warning");
				return;
			}

			footerMode = nextMode;
			pi.appendEntry<UsageModeEntry>(USAGE_MODE_ENTRY, { mode: footerMode });
			requestFooterRender?.();
			ctx.ui.notify(`Footer mode: ${footerMode}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === USAGE_MODE_ENTRY) {
				const data = entry.data as UsageModeEntry | undefined;
				if (data?.mode && isFooterMode(data.mode)) footerMode = data.mode;
			}
		}

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestFooterRender = () => tui.requestRender();
			const refreshForCurrentBranch = () => {
				void refresh(footerData.getGitBranch(), () => tui.requestRender());
			};

			refreshForCurrentBranch();
			const unsubscribe = footerData.onBranchChange(refreshForCurrentBranch);

			return {
				dispose: () => {
					if (requestFooterRender) requestFooterRender = null;
					unsubscribe();
				},
				invalidate() {},
				render(width: number): string[] {
					const cwd = toHomeRelativePath(ctx.cwd);
					const label = branch ? (repoInfo?.alias ?? cwd) : cwd;
					const repoUrl = repoInfo ? `https://${repoInfo.host}/${repoInfo.alias}` : undefined;

					const topSegments: Segment[] = [{ text: label, color: "success", linkUrl: repoUrl }];
					if (branch) topSegments.push({ text: ` (${branch})`, color: "dim" });
					if (pullRequest) {
						topSegments.push({
							text: ` #${pullRequest.number}`,
							color: "warning",
							linkUrl: pullRequest.url,
						});
					}

					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) topSegments.push({ text: ` • ${sessionName}`, color: "dim" });

					const topLine = renderSegments(truncateSegments(topSegments, width), theme);

					let totalInput = 0;
					let totalOutput = 0;
					let totalCacheRead = 0;
					let totalCacheWrite = 0;
					let totalCost = 0;

					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const message = entry.message as AssistantMessage;
							totalInput += message.usage.input;
							totalOutput += message.usage.output;
							totalCacheRead += message.usage.cacheRead;
							totalCacheWrite += message.usage.cacheWrite;
							totalCost += message.usage.cost.total;
						}
					}

					let turnCost = 0;
					const branchEntries = ctx.sessionManager.getBranch();
					for (let i = branchEntries.length - 1; i >= 0; i--) {
						const entry = branchEntries[i];
						if (!entry) continue;
						if (entry.type === "message" && entry.message.role === "assistant") {
							const message = entry.message as AssistantMessage;
							turnCost = message.usage.cost.total;
							break;
						}
					}

					const usage = ctx.getContextUsage();
					const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextPercent = usage?.percent;
					const context =
						contextPercent === null || contextPercent === undefined
							? `?/${formatTokens(contextWindow)} (auto)`
							: `${contextPercent.toFixed(1)}%/${formatTokens(contextWindow)} (auto)`;
					const contextSegment: Segment = { text: context, color: contextColor(contextPercent) };

					const leftSegments: Segment[] =
						footerMode === "focus"
							? [
									{ text: `+$${turnCost.toFixed(3)} • $${totalCost.toFixed(3)} `, color: "dim" },
									contextSegment,
								]
							: footerMode === "debug"
								? [
										{
											text: `+$${turnCost.toFixed(3)} • $${totalCost.toFixed(3)} • ↑${formatTokens(totalInput)} ↓${formatTokens(totalOutput)} R${formatTokens(totalCacheRead)} W${formatTokens(totalCacheWrite)} `,
											color: "dim",
										},
										contextSegment,
									]
								: [contextSegment];

					const model = ctx.model?.id ?? "no-model";
					const level = ctx.model?.reasoning ? pi.getThinkingLevel() : null;
					const rightSegments: Segment[] = [{ text: model, color: "accent" }];
					if (level) {
						rightSegments.push({
							text: level === "off" ? " • thinking off" : ` • ${level}`,
							color: thinkingColor(level),
						});
					}

					const leftLength = leftSegments.reduce((sum, segment) => sum + segment.text.length, 0);
					const rightLength = rightSegments.reduce((sum, segment) => sum + segment.text.length, 0);
					const spacing = Math.max(2, width - leftLength - rightLength);

					const usageLine = renderSegments(
						truncateSegments([...leftSegments, { text: " ".repeat(spacing), color: "dim" }, ...rightSegments], width),
						theme,
					);

					const lines = [topLine, usageLine];

					const extensionStatuses = footerData.getExtensionStatuses();
					if (extensionStatuses.size > 0) {
						const sortedStatuses = Array.from(extensionStatuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => sanitizeStatusText(text));
						lines.push(renderSegments(truncateSegments([{ text: sortedStatuses.join(" "), color: "dim" }], width), theme));
					}

					return lines;
				},
			};
		});
	});
}
