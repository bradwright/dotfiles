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
  - Utility module shared by `plan.ts` and `build-agents.ts`. Not an extension entry point — not listed in `pi/package.json`.
  - Exports common helpers (e.g. path utilities, plan directory helpers, JSONL event log helpers).

- `plan.ts`
  - Adds a lightweight `/plan` orchestrator command:
    - `/plan [brief]` (continue active plan flow or create/start one)
    - `new [context|github-issue-url]`
    - `use <plan-dir>` / `resume [plan-dir]`
    - `review [--model <id>]` / `status` / `clear`
  - Keeps extension logic intentionally thin: active plan selection, package creation, and routing to `/skill:plan-methodology`.
  - Persists only active plan path in session state (`plan-state`).
  - Shows active plan slug in footer status (`📋 <slug>`).
  - `/plan new <github-issue-url>` fetches issue details via `gh issue view`, saves them to `brief.md`, and seeds `feedback.md`.
  - `/plan review [--model <id>]` forwards optional model steering to the skill so review runs can target different models (e.g. Codex vs Opus). Legacy `/plan review <model>` is still accepted.
  - Does **not** enforce a planning mode, tool restrictions, thinking-level toggles, or auto-resume loops.

- `build-agents.ts`
  - Adds `/build` command for implementation from a plan file.
  - Supports single-agent (direct implementation) and multi-agent (parallel workers via `Agent` tool) modes.
  - Accepts a plan file, plan directory, or inline description. Checks for approval in `changelog.md` (bypass with `--yolo`).
  - Multi-agent run lifecycle tracked via `status.json`. Task-level state managed by the supervisor LLM.
  - Artifacts (`RESULT.md`, `REVIEW.md`) live in worktrees; supervisor collects them via `get_subagent_result`.
  - Subcommands: `status`, `cancel`, `cleanup`.

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
