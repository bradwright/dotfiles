// -*- mode: typescript -*-
// Plan-mode tool-call guard sub-extension.
//
// Enforces write containment and bash safety restrictions while plan mode is
// active. State is maintained locally and kept in sync via the
// "plan:state-changed" event emitted by plan.ts whenever plan mode is toggled
// or the active plan directory changes.
//
// Defaults to permissive (no restrictions) when state is unknown — the guard
// is only activated once plan.ts confirms plan mode is enabled.

import * as path from "node:path";

import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
	isWithinDirectory,
	normalizeInputPath,
	resolvePathForContainment,
	toDisplayPath,
} from "./lib/shared.js";

// ---------------------------------------------------------------------------
// Bash safety patterns
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true iff `command` is a read-only bash invocation that is safe to
 * run during plan mode.
 *
 * Compound commands (separated by `;`, `&&`, or `||`) are split and each
 * sub-command is evaluated independently. Any sub-command that is blocked or
 * not explicitly allowed causes the whole command to be rejected (fail-closed).
 */
function isSafeBashCommand(command: string): boolean {
	// Split on shell separators to handle compound commands.
	// Preserve fail-closed: if any sub-command is unsafe, the whole command is blocked.
	const subCommands = command.split(/;|&&|\|\|/);

	// Fail closed: an empty command or one that reduces to only separators
	// (all segments are blank after trimming) is not a valid safe command.
	let hasValidSubCommand = false;

	for (const sub of subCommands) {
		const trimmed = sub.trim();
		if (!trimmed) continue; // skip empty segments (e.g. trailing semicolons)

		hasValidSubCommand = true;

		const blocked = BLOCKED_BASH_PATTERNS.some((pattern) => pattern.test(trimmed));
		const allowed = SAFE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed));

		if (blocked || !allowed) return false;
	}

	// If no non-empty sub-command was found, fail closed.
	return hasValidSubCommand;
}

// ---------------------------------------------------------------------------
// State entry keys (must match what plan.ts persists)
// ---------------------------------------------------------------------------

const STATE_ENTRY = "plan-state";
const LEGACY_STATE_ENTRY = "plan-mode-state";

type PlanStateSnapshot = {
	enabled?: boolean;
	activePlanDir?: string | null;
	[key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
	// Local mirror of plan-mode state. Defaults to permissive (off) so that
	// the guards are inactive until plan.ts confirms plan mode is enabled.
	let planEnabled = false;
	let activePlanDir: string | null = null;

	// -------------------------------------------------------------------------
	// State sync via event bus
	// -------------------------------------------------------------------------

	// Listen for state-change events emitted by plan.ts whenever plan mode is
	// toggled or the active plan directory changes.
	pi.events.on("plan:state-changed", (data) => {
		const snapshot = data as PlanStateSnapshot;
		planEnabled = Boolean(snapshot.enabled);
		activePlanDir =
			typeof snapshot.activePlanDir === "string"
				? path.resolve(snapshot.activePlanDir)
				: null;
	});

	// -------------------------------------------------------------------------
	// Session restore
	// -------------------------------------------------------------------------

	// On session start, reconstruct guard state from the persisted session
	// branch so that guards are immediately active in resumed sessions without
	// waiting for plan.ts to re-emit "plan:state-changed".
	pi.on("session_start", async (_event, ctx) => {
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;
			if (entry.customType !== STATE_ENTRY && entry.customType !== LEGACY_STATE_ENTRY) continue;

			const data = entry.data as PlanStateSnapshot | undefined;
			if (!data) continue;

			// Use the last matching entry (most recent state).
			planEnabled = Boolean(data.enabled);
			activePlanDir =
				typeof data.activePlanDir === "string"
					? path.resolve(data.activePlanDir)
					: null;
		}
		// If no state entry was found, planEnabled remains false (permissive default).
	});

	// -------------------------------------------------------------------------
	// Tool-call guards
	// -------------------------------------------------------------------------

	pi.on("tool_call", async (event, ctx) => {
		// Guards are only active while plan mode is enabled.
		if (!planEnabled) return;

		// Write containment: edit and write operations are restricted to the
		// active plan package directory.
		if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
			const requestedPath = event.input.path;

			if (!activePlanDir) {
				return {
					block: true,
					reason:
						"Plan mode only allows edits in an active plan package. Set one with /plan new [context] or /plan resume <plan-dir>.",
				};
			}

			const planRoot = resolvePathForContainment(activePlanDir, ctx.cwd);
			const target = resolvePathForContainment(requestedPath, ctx.cwd);

			if (!isWithinDirectory(target, planRoot)) {
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

		// Bash safety: only read-only commands are permitted.
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
}
