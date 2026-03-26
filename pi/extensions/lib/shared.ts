// -*- mode: typescript -*-
// Shared utility module for pi extensions.
// Pure functions only — no pi API dependency, no default extension export.

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REQUIRED_PLAN_FILES = ["plan.md", "feedback.md", "changelog.md"] as const;

// ---------------------------------------------------------------------------
// Date / string formatting
// ---------------------------------------------------------------------------

export function localIsoDate(now = new Date()): string {
	const yyyy = now.getFullYear();
	const mm = `${now.getMonth() + 1}`.padStart(2, "0");
	const dd = `${now.getDate()}`.padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

export function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-")
		.slice(0, 60);
}

export function toTitleCase(value: string): string {
	return value
		.split(/[-\s]+/)
		.filter(Boolean)
		.map((part) => part[0].toUpperCase() + part.slice(1))
		.join(" ");
}

export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	return {
		text: `${text.slice(0, Math.max(0, maxChars - 14)).trimEnd()}\n\n[...truncated]`,
		truncated: true,
	};
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function toDisplayPath(targetPath: string, cwd: string): string {
	const resolved = path.resolve(targetPath);
	const fromCwd = path.relative(cwd, resolved);
	if (!fromCwd.startsWith("..") && !path.isAbsolute(fromCwd)) return `./${fromCwd}`;

	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && resolved.startsWith(home)) return `~${resolved.slice(home.length)}`;

	return resolved;
}

export function stripMatchingQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

export function expandHome(inputPath: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return inputPath;
	if (inputPath === "~") return home;
	if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
		return path.join(home, inputPath.slice(2));
	}
	return inputPath;
}

export function normalizeInputPath(inputPath: string, cwd: string): string {
	const trimmed = stripMatchingQuotes(inputPath.trim()).replace(/^@/, "");
	const expanded = expandHome(trimmed);
	return path.resolve(cwd, expanded);
}

export function resolvePathForContainment(inputPath: string, cwd: string): string {
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

export function isWithinDirectory(targetPath: string, directoryPath: string): boolean {
	const rel = path.relative(path.resolve(directoryPath), path.resolve(targetPath));
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// ---------------------------------------------------------------------------
// Plan directory helpers
// ---------------------------------------------------------------------------

/** Returns names of required plan files that are missing from `planDir`. */
export function requiredFilesMissing(planDir: string): string[] {
	return REQUIRED_PLAN_FILES.filter((file) => !fs.existsSync(path.join(planDir, file)));
}

/**
 * Returns true if `changelog.md` at `changelogPath` contains an approval
 * entry of the form "- Approved — YYYY-MM-DD, user."
 */
export function hasApprovedEntry(changelogPath: string): boolean {
	if (!fs.existsSync(changelogPath) || !fs.statSync(changelogPath).isFile()) return false;
	const content = fs.readFileSync(changelogPath, "utf8");
	return /^\s*-\s*Approved\s+[—-]\s+\d{4}-\d{2}-\d{2},\s+user\./m.test(content);
}

/**
 * Lists plan directories under `<cwd>/.pi/plans/` that have an approved
 * changelog entry, sorted newest-first by directory name.
 */
export function listApprovedPlanDirs(cwd: string): string[] {
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
// Generic JSONL event log helpers
// ---------------------------------------------------------------------------

/**
 * Reads a JSONL event log file and returns parsed entries as `T[]`.
 * Lines that fail to parse are silently skipped.
 *
 * @param filePath  Absolute path to the `.jsonl` file.
 */
export function readJsonlEvents<T>(filePath: string): T[] {
	if (!fs.existsSync(filePath)) return [];
	try {
		return fs
			.readFileSync(filePath, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line) as T;
				} catch {
					return null;
				}
			})
			.filter((entry): entry is T => entry !== null);
	} catch {
		return [];
	}
}

/**
 * Appends a single event as a JSON line to `filePath`.
 *
 * @param filePath  Absolute path to the `.jsonl` file (created if absent).
 * @param event     The event object to serialise and append.
 */
export function appendJsonlEvent<T>(filePath: string, event: T): void {
	fs.appendFileSync(filePath, JSON.stringify(event) + "\n");
}

// ---------------------------------------------------------------------------
// Auto-resume tracker
// ---------------------------------------------------------------------------

/**
 * Tracks agent turns and rate-limits auto-resume attempts when the agent
 * hits a context limit. Shared by plan and build extensions.
 *
 * Usage:
 *   - Call `tick()` on each `before_agent_start` / agent turn.
 *   - Call `reset()` on `agent_start` (new session).
 *   - Call `shouldResume()` on `agent_end` — returns true if a resume
 *     message should be sent.
 */
export class AutoResumeTracker {
	private turns = 0;
	private lastResumeTime = 0;

	constructor(
		private maxTurns = 5,
		private cooldownMs = 60_000,
	) {}

	reset(): void {
		this.turns = 0;
	}

	tick(): void {
		this.turns++;
	}

	/** Returns true if auto-resume should fire, false if rate-limited or exhausted. */
	shouldResume(): { ok: true } | { ok: false; reason: "no-turns" | "cooldown" | "exhausted" } {
		if (this.turns === 0) return { ok: false, reason: "no-turns" };

		const now = Date.now();
		if (now - this.lastResumeTime < this.cooldownMs) return { ok: false, reason: "cooldown" };
		if (this.turns >= this.maxTurns) return { ok: false, reason: "exhausted" };

		this.lastResumeTime = now;
		return { ok: true };
	}
}
