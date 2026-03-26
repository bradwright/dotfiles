# Pi Extensions Notes

This directory contains project-local Pi extensions.

## Files

- `github-statusline.ts`
  - Replaces the default Pi footer with a custom statusline.
  - Top line:
    - Shows GitHub repo alias + branch.
    - Falls back to current directory when not a GitHub repo.
    - Shows PR number (if found).
    - Repo alias and PR number are OSC 8 hyperlinks.
      - Repo alias links to `https://<host>/<owner>/<repo>`.
      - PR number links to the PR URL.
    - Colors:
      - Repo/directory label: `success`.
      - Branch/session text: `dim`.
      - PR number: `warning`.
  - Usage line:
    - Right side: model (`accent`) + thinking level (`thinking*` colors).
    - Left side has modes controlled by `/toggle-usage`:
      - `minimal`: context only (e.g. `26.4%/272k (auto)`).
      - `focus`: turn cost + session cost + context.
      - `debug`: turn/session cost + token/cache counters + context.
    - Context color is dim normally, warning near limit, error when very high.
  - `/toggle-usage` command:
    - No args cycles mode.
    - Accepts `minimal|focus|debug|cycle`.
    - Mode persists in session via custom entry `github-statusline-usage-mode`.
  - PR lookup behavior:
    - Uses `gh pr list` by branch.
    - Includes a short in-memory cache (TTL 30s) to reduce repeated lookups.


- `shared.ts`
  - Utility module shared by `plan.ts` and `plan-guards.ts`. Not an extension entry point — not listed in `pi/package.json`.
  - Exports common helpers (e.g. plan-state reading/writing, session entry key, path utilities) used across plan-related extensions.

- `plan-guards.ts`
  - Plan-mode guard sub-extension that listens to the `plan:state-changed` event.
  - Enforces tool restrictions when plan mode is active: allows only read-oriented bash commands and limits `edit`/`write` to the active plan package directory.
  - Registered in `pi/package.json` after `plan.ts`.

- `plan.ts`
  - Adds `/plan` command for planning-state controls:
    - `on|off|toggle|status|mode [medium|high|xhigh]`
    - `new [context|github-issue-url]` (creates `.pi/plans/<date>-<slug>/` package files and auto-starts `/skill:plan-methodology`)
    - `resume [plan-dir]` / `review` / `clear`
  - `/plan new <github-issue-url>` fetches issue details via `gh issue view`, saves them to `brief.md`, seeds `feedback.md`, and uses them as the initial planning brief.
  - `/plan resume` with no args opens a selector of available plan packages under `./.pi/plans`.
  - `/plan mode` shows a thinking-level selector (`medium|high|xhigh`) with `high` as the default.
  - Entering plan mode sets thinking to the selected plan thinking level and restores previous thinking when exiting plan mode.
  - `/plan review` auto-enables plan mode guardrails (if needed) and delegates review via the plan-methodology skill, which dispatches a `plan-reviewer` agent via `Agent()` when available or runs review in-session as fallback.
  - Adds `/build` command to disable plan mode and queue implementation from active `plan.md`.
    - `/build mode` shows a thinking-level selector (`low|medium|high|xhigh`) with `medium` as the default.
    - Sets thinking to the selected build thinking level when starting build.
    - Requires `Approved — <date>, user.` in `changelog.md` by default.
    - `--yolo` bypasses the approval check.
  - Persists mode state (`enabled`, active plan path, previous tool set) in session entry `plan-state`.
  - Shows active plan slug in footer status while plan mode is enabled.
  - Restricts tool usage in plan mode:
    - Active tool set includes `edit`/`write` for plan docs and `Agent` for delegation.
    - Blocks `edit`/`write` outside the active plan package.
    - Allows only read-oriented bash commands.
  - The `Agent` tool is included in plan mode tools so the LLM can delegate scouting and drafting to agents (Explore, writer) per the plan-methodology skill, keeping the primary agent's context window small.
  - Injects hidden planning context before each turn when plan mode is enabled.
  - Auto-detects active plan dir from `/skill:plan-methodology review <plan-dir>` input.

- `build-agents.ts`
  - Adds `/build-agents` for multi-agent implementation orchestration.
  - Checks for the `Agent` tool to determine if `@tintinweb/pi-subagents` is available.
  - Run lifecycle tracked via `status.json` (simple `{ phase }` marker).
  - Task-level state is managed entirely by the supervisor LLM — the extension handles run lifecycle, system prompt injection, auto-resume, and the widget.
  - Artifacts (`RESULT.md`, `REVIEW.md`) live in worktrees; supervisor collects them via `get_subagent_result`.

## Agent files

- `writer.md` — Agent definition for the writer agent, used for implementation/drafting tasks delegated from plan mode.

## Operational notes

- After changes, run `/reload` in Pi to apply extension updates.
- Dotfiles install symlinks this directory into `~/.pi/agent/extensions/` via `make install_pi`.
- Keep footer rendering lightweight: avoid expensive per-render shell commands.
- Prefer branch-change-triggered refresh + cached metadata for git/GitHub info.
- Install the subagents package with: `pi install npm:@tintinweb/pi-subagents`

> **Phase 2 note:** Phase 2 will replace the `build-agents-prompt.md` LLM-driven orchestration with an extension-driven state machine for more deterministic task lifecycle management.

## Package manifest (`pi/package.json`)

The `pi` field in `package.json` explicitly declares extensions, skills, and
themes. **Once a `pi` manifest exists, convention-based auto-discovery is
disabled** — pi only loads what is listed. If you add a new extension, skill
directory, or theme file, you must also add it to the corresponding array in
the manifest or it will not be loaded.
