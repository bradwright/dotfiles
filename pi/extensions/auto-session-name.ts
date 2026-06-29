/**
 * auto-session-name — auto-rename the current Pi session using a cheap model.
 *
 * Why: the default session name (first user message) is useless when you have a
 * lot of sessions going at once, or when you want to `/resume` something by name.
 * This watches the conversation and sets a short, human-readable title using the
 * cheapest model you have auth for — so the session selector reads like a to-do
 * list instead of a wall of identical-looking first lines.
 *
 * Behaviour:
 *   - On by default for every session. Names after the first exchange, and also
 *     proactively on session start (resume / reload / fork) when a session has
 *     content but no name yet — so you never have to trigger it by hand.
 *   - Re-evaluates every N user messages (default 5) so the title tracks topic
 *     drift without churn.
 *   - Runs only in the interactive TUI session (never subagents / headless runs).
 *   - Never overwrites a name you set yourself (`/name`, `--name`, or `/autoname`):
 *     the first time it sees a name it didn't write, it backs off for that session.
 *   - Picks the cheapest available model automatically; override with
 *     `/autoname model <id>`, `--autoname-model <id>`, or `$PI_AUTONAME_MODEL`.
 *   - Persists its state as custom session entries, so it survives `/reload`,
 *     `/resume`, and `/fork`.
 *
 * Commands:
 *   /autoname              show status (on/off, model, current name)
 *   /autoname now          force a rename right now (also re-enables)
 *   /autoname off | on     disable / enable for this session
 *   /autoname model <id>   pin the model used for naming (provider/id or id)
 *
 * Env / flags:
 *   PI_AUTONAME_MODEL=provider/id   pin the naming model
 *   PI_AUTONAME_EVERY=5             re-evaluate every N user messages
 *   PI_AUTONAME_DEFAULT=off         opt new sessions out of auto-naming (default: on)
 *   PI_AUTONAME_DEBUG=1             append diagnostics to ~/.pi/agent/auto-session-name.log
 */

import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { complete } from "@earendil-works/pi-ai/compat";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATE_TYPE = "auto-session-name";
const TITLE_MAX_CHARS = 60;
const CONVO_MAX_CHARS = 4000;
/** Hard ceiling on the naming model call so a slow/wedged request can never
 * leave the in-flight guard stuck (SDK clients otherwise default to ~10 min). */
const NAMING_TIMEOUT_MS = 30_000;

/**
 * Bias toward known-good cheap/fast models when several are available. Within a
 * single hint we still pick the lowest-cost match, and if none of these match we
 * fall back to the genuinely cheapest model you have auth for.
 */
const PREFERRED_MODEL_HINTS = [
	"haiku",
	"nano",
	"flash-lite",
	"4o-mini",
	"4.1-mini",
	"-mini",
	"flash",
];

interface AutoNameState {
	/** The last title we set (used to detect user overrides). */
	name?: string;
	/** User-message count at the last time we named. */
	userMsgCount: number;
	/** Whether auto-naming is off for this session. */
	disabled: boolean;
	/** A pinned model override ("provider/id" or "id"), if set via /autoname model. */
	modelOverride?: string;
}

interface NameResult {
	ok: boolean;
	title?: string;
	model?: string;
	reason?: string;
}

// Module-scoped per-session state. Rebuilt on every (re)load via session_start.
let state: AutoNameState = { userMsgCount: 0, disabled: false };
let restored = false;
let inFlight = false;
/** AbortController for the in-progress naming call, so it can be cancelled. */
let activeAbort: AbortController | undefined;
/** Last failure reason, surfaced via `/autoname` status. */
let lastError: string | undefined;

function debug(msg: string): void {
	if (!process.env.PI_AUTONAME_DEBUG) return;
	try {
		appendFileSync(
			join(homedir(), ".pi", "agent", "auto-session-name.log"),
			`${new Date().toISOString()} ${msg}\n`,
		);
	} catch {
		/* logging must never break the agent */
	}
}

/** Whether auto-naming is OFF by default for brand-new sessions. Default: on. */
function defaultDisabled(): boolean {
	const v = (process.env.PI_AUTONAME_DEFAULT ?? "on").trim().toLowerCase();
	return v === "off" || v === "0" || v === "false" || v === "no";
}

// --- conversation extraction ----------------------------------------------

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (part && typeof part === "object") {
			const block = part as { type?: string; text?: string };
			if (block.type === "text" && typeof block.text === "string") {
				parts.push(block.text);
			}
		}
	}
	return parts.join("\n");
}

/** Count genuine user prompts (not tool results or extension-injected messages). */
function countUserMessages(branch: unknown[]): number {
	let n = 0;
	for (const entry of branch as Array<{ type?: string; message?: { role?: string } }>) {
		if (entry.type === "message" && entry.message?.role === "user") n++;
	}
	return n;
}

/**
 * Build a compact transcript. Keeps the opening of the conversation (the original
 * goal) plus the most recent turns (where the topic may have drifted), trimmed to
 * keep the cheap-model call fast and inexpensive.
 */
function buildConversationText(branch: unknown[]): string {
	const lines: string[] = [];
	for (const entry of branch as Array<{ type?: string; message?: { role?: string; content?: unknown } }>) {
		if (entry.type !== "message") continue;
		const role = entry.message?.role;
		if (role !== "user" && role !== "assistant") continue;
		const text = extractText(entry.message?.content).trim();
		if (!text) continue;
		lines.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
	}

	let convo = lines.join("\n\n");
	if (convo.length > CONVO_MAX_CHARS) {
		const head = convo.slice(0, Math.floor(CONVO_MAX_CHARS * 0.45)).trim();
		const tail = convo.slice(convo.length - Math.floor(CONVO_MAX_CHARS * 0.5)).trim();
		convo = `${head}\n\n…\n\n${tail}`;
	}
	return convo;
}

function buildPrompt(convo: string, currentName?: string): string {
	const lines = [
		"You name coding-assistant sessions so they are easy to find later in a long list of sessions.",
		"Read the conversation and produce ONE short title.",
		"",
		"Requirements:",
		"- 2 to 6 words, roughly 20 to 45 characters.",
		"- Describe the concrete task/topic (feature, file, bug, or area), not the tools used.",
		"- Plain Title Case. No quotes, backticks, markdown, emoji, or trailing punctuation.",
		'- No generic filler like "Help", "Question", "Task", "Session", or "Coding".',
		"- Output ONLY the title, nothing else.",
	];
	if (currentName) {
		lines.push(
			`- A current title already exists: "${currentName}". If it is still accurate, repeat it EXACTLY. Only change it if the topic has clearly shifted.`,
		);
	}
	lines.push("", "<conversation>", convo, "</conversation>", "", "Title:");
	return lines.join("\n");
}

function sanitizeTitle(raw: string): string | undefined {
	let t = (raw ?? "")
		.split("\n")
		.map((s) => s.trim())
		.find(Boolean) ?? "";
	t = t.replace(/^(title|session|name)\s*[:\-–]\s*/i, ""); // strip leading "Title:" etc.
	t = t.replace(/^["'`*_#\s]+/, "").replace(/["'`*_\s]+$/, ""); // strip wrapping punctuation
	t = t.replace(/\s+/g, " ").trim();
	t = t.replace(/[.\s]+$/, ""); // no trailing period
	if (!t) return undefined;
	if (t.length > TITLE_MAX_CHARS) t = t.slice(0, TITLE_MAX_CHARS).trim();
	return t || undefined;
}

// --- model selection --------------------------------------------------------

function cost(m: Model<Api>): number {
	return (m.cost?.input ?? 0) + (m.cost?.output ?? 0);
}

function resolveModelOverride(ctx: ExtensionContext, override: string): Model<Api> | undefined {
	const available = ctx.modelRegistry.getAvailable();
	if (override.includes("/")) {
		const idx = override.indexOf("/");
		const provider = override.slice(0, idx);
		const id = override.slice(idx + 1);
		return ctx.modelRegistry.find(provider, id) ?? available.find((m) => m.id === id);
	}
	return available.find((m) => m.id === override);
}

/** Pick the cheapest available model, honouring an explicit override and cheap hints. */
function pickModel(ctx: ExtensionContext): Model<Api> | undefined {
	const available = ctx.modelRegistry.getAvailable();
	if (available.length === 0) return undefined;

	const override =
		state.modelOverride ||
		(typeof pi.getFlag?.("autoname-model") === "string"
			? (pi.getFlag("autoname-model") as string)
			: undefined) ||
		process.env.PI_AUTONAME_MODEL;
	if (override) {
		const m = resolveModelOverride(ctx, override);
		if (m) return m;
		debug(`override "${override}" not found among available models`);
	}

	const textCapable = available.filter((m) => m.input?.includes("text"));
	const pool = textCapable.length ? textCapable : available;

	for (const hint of PREFERRED_MODEL_HINTS) {
		const matches = pool.filter((m) => m.id.toLowerCase().includes(hint));
		if (matches.length) {
			return matches.sort((a, b) => cost(a) - cost(b))[0];
		}
	}

	return [...pool].sort((a, b) => cost(a) - cost(b))[0];
}

// --- state persistence ------------------------------------------------------

function persist(): void {
	try {
		pi.appendEntry<AutoNameState>(STATE_TYPE, { ...state });
	} catch (err) {
		debug(`persist failed: ${String(err)}`);
	}
}

function restore(ctx: ExtensionContext): void {
	state = { userMsgCount: 0, disabled: defaultDisabled() };
	for (const entry of ctx.sessionManager.getEntries() as Array<{
		type?: string;
		customType?: string;
		data?: Partial<AutoNameState>;
	}>) {
		if (entry.type === "custom" && entry.customType === STATE_TYPE && entry.data) {
			state = {
				name: entry.data.name,
				userMsgCount: entry.data.userMsgCount ?? 0,
				disabled: Boolean(entry.data.disabled),
				modelOverride: entry.data.modelOverride,
			};
		}
	}
	// If a display name exists that we didn't write, the user owns it — back off.
	const current = ctx.sessionManager.getSessionName();
	if (current && current !== state.name) {
		state.disabled = true;
		debug(`existing user name "${current}" detected; auto-naming disabled`);
	}
	restored = true;
}

// --- core naming ------------------------------------------------------------

async function generateAndSet(
	ctx: ExtensionContext,
	branch: unknown[],
	userMsgs: number,
	signal: AbortSignal,
): Promise<NameResult> {
	const model = pickModel(ctx);
	if (!model) {
		const reason = "no model with configured auth is available";
		debug(reason);
		lastError = reason;
		return { ok: false, reason };
	}
	const tag = `${model.provider}/${model.id}`;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		const reason = auth.ok ? "no API key (OAuth-only credentials?)" : auth.error;
		debug(`no usable auth for ${tag}: ${reason}`);
		lastError = `${tag}: ${reason}`;
		return { ok: false, model: tag, reason };
	}

	const convo = buildConversationText(branch);
	if (!convo.trim()) return { ok: false, model: tag, reason: "no conversation text yet" };

	const messages = [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: buildPrompt(convo, ctx.sessionManager.getSessionName()) }],
			timestamp: Date.now(),
		},
	];

	debug(`naming with ${tag} (userMsgs=${userMsgs})`);
	let response;
	try {
		response = await complete(
			model,
			{ messages },
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				// Generous enough that reasoning models (nano/haiku/flash) still have
				// room to emit the title after their hidden reasoning tokens. The title
				// itself is tiny, so non-reasoning models stop well before this.
				maxTokens: 256,
				// Ignored by non-reasoning models; keeps reasoning models fast/cheap.
				// (No custom temperature: some reasoning models reject non-default values.)
				reasoningEffort: "low",
				signal,
				// Fail fast: don't hang for minutes or burn retries on a flaky call.
				timeoutMs: NAMING_TIMEOUT_MS,
				maxRetries: 0,
			},
		);
	} catch (err) {
		const reason = signal.aborted
			? `timed out / cancelled after ${NAMING_TIMEOUT_MS / 1000}s`
			: String((err as Error)?.message ?? err);
		debug(`complete() failed for ${tag}: ${reason}`);
		lastError = `${tag}: ${reason}`;
		return { ok: false, model: tag, reason };
	}

	const text = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join(" ");
	const title = sanitizeTitle(text);
	if (!title) {
		const reason = "model returned no usable title";
		debug(`${reason} from ${tag}: ${JSON.stringify(text)}`);
		lastError = `${tag}: ${reason}`;
		return { ok: false, model: tag, reason };
	}

	state.userMsgCount = userMsgs;
	if (title !== ctx.sessionManager.getSessionName()) {
		pi.setSessionName(title);
		debug(`set session name: ${title}`);
	}
	state.name = title;
	persist();
	lastError = undefined;
	return { ok: true, title, model: tag };
}

/**
 * Run a naming attempt with a guaranteed-settling lifecycle: owns `inFlight`,
 * wires the agent's abort signal, and enforces a hard timeout so the in-flight
 * guard can never get stuck on a slow or wedged model call.
 */
async function runNaming(ctx: ExtensionContext, branch: unknown[], userMsgs: number): Promise<NameResult> {
	const ac = new AbortController();
	const onParentAbort = () => ac.abort();
	ctx.signal?.addEventListener("abort", onParentAbort);
	// Backstop in case the provider ignores `timeoutMs`.
	const timer = setTimeout(() => ac.abort(), NAMING_TIMEOUT_MS + 2_000);
	activeAbort = ac;
	inFlight = true;
	try {
		return await generateAndSet(ctx, branch, userMsgs, ac.signal);
	} finally {
		clearTimeout(timer);
		ctx.signal?.removeEventListener("abort", onParentAbort);
		if (activeAbort === ac) activeAbort = undefined;
		inFlight = false;
	}
}

/** Whether enough has changed to (re)name now. */
function shouldNameNow(userMsgs: number): boolean {
	if (userMsgs === 0) return false;
	const every = Number.parseInt(process.env.PI_AUTONAME_EVERY ?? "", 10) || 5;
	return state.name === undefined ? userMsgs >= 1 : userMsgs - state.userMsgCount >= every;
}

/**
 * Shared entry point for automatic naming, used by both session_start (resume /
 * reload / fork into existing content) and agent_end (after each turn). Honours
 * the on/off state, backs off from user-set names, and never blocks the caller.
 */
function maybeNameInBackground(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return; // only the interactive session, never subagents
	if (!ctx.sessionManager.getSessionFile()) return; // skip ephemeral / in-memory
	if (!restored) restore(ctx);
	if (state.disabled) return;

	// Detect a name set by the user (or anything other than us) and back off.
	const current = ctx.sessionManager.getSessionName();
	if (current && current !== state.name) {
		state.disabled = true;
		persist();
		debug(`user-set name "${current}"; disabling auto-naming`);
		return;
	}

	const branch = ctx.sessionManager.getBranch();
	const userMsgs = countUserMessages(branch);
	if (!shouldNameNow(userMsgs) || inFlight) return;

	// Fire-and-forget: don't block returning control to the user.
	void runNaming(ctx, branch, userMsgs).catch((err) => debug(`naming error: ${String(err)}`));
}

// --- extension --------------------------------------------------------------

let pi!: ExtensionAPI;

export default function (api: ExtensionAPI) {
	pi = api;

	pi.registerFlag("autoname-model", {
		description: "Model used to auto-name sessions (provider/id or id)",
	});

	pi.on("session_start", async (_event, ctx) => {
		restored = false;
		inFlight = false;
		activeAbort = undefined;
		lastError = undefined;
		try {
			restore(ctx);
			// Proactively name sessions resumed/reloaded/forked into existing content,
			// without waiting for the next turn. New (empty) sessions are a no-op here.
			maybeNameInBackground(ctx);
		} catch (err) {
			debug(`session_start handler error: ${String(err)}`);
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		try {
			maybeNameInBackground(ctx);
		} catch (err) {
			debug(`agent_end handler error: ${String(err)}`);
		}
	});

	pi.registerCommand("autoname", {
		description: "Control auto session naming (now | on | off | model <id> | status)",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const [sub, ...rest] = trimmed.split(/\s+/);

			switch (sub) {
				case "off":
					state.disabled = true;
					persist();
					ctx.ui.notify("Auto-naming disabled for this session", "info");
					return;

				case "on":
					state.disabled = false;
					persist();
					ctx.ui.notify("Auto-naming enabled for this session", "info");
					return;

				case "model": {
					const value = rest.join(" ").trim();
					if (!value) {
						ctx.ui.notify(
							state.modelOverride
								? `Pinned naming model: ${state.modelOverride}`
								: "No model pinned (using cheapest available)",
							"info",
						);
						return;
					}
					state.modelOverride = value;
					persist();
					const resolved = pickModel(ctx);
					ctx.ui.notify(
						resolved
							? `Naming model pinned: ${resolved.provider}/${resolved.id}`
							: `Pinned "${value}" but no matching model has auth`,
						resolved ? "info" : "warning",
					);
					return;
				}

				case "now": {
					state.disabled = false;
					const branch = ctx.sessionManager.getBranch();
					const userMsgs = countUserMessages(branch);
					if (userMsgs === 0) {
						ctx.ui.notify("Nothing to name yet — send a message first", "warning");
						return;
					}
					// A background attempt may be slow or wedged — cancel it and take over
					// rather than refusing, so /autoname now is never permanently blocked.
					if (inFlight) {
						ctx.ui.notify("Cancelling the in-progress attempt…", "info");
						activeAbort?.abort();
						const start = Date.now();
						while (inFlight && Date.now() - start < 3_000) {
							await new Promise((r) => setTimeout(r, 50));
						}
					}
					ctx.ui.notify("Generating session name…", "info");
					const result = await runNaming(ctx, branch, userMsgs);
					if (result.ok) {
						ctx.ui.notify(`Named: ${result.title}  (${result.model})`, "info");
					} else {
						ctx.ui.notify(
							`Couldn't name${result.model ? ` via ${result.model}` : ""}: ${result.reason}`,
							"warning",
						);
					}
					return;
				}

				default: {
					const model = pickModel(ctx);
					ctx.ui.notify(
						`Auto-naming: ${state.disabled ? "off" : "on"} | ` +
							`model: ${model ? `${model.provider}/${model.id}` : "none available"} | ` +
							`name: ${pi.getSessionName() ?? "(unset)"}` +
							(inFlight ? " | naming…" : "") +
							(lastError ? ` | last error: ${lastError}` : ""),
						"info",
					);
				}
			}
		},
	});
}
