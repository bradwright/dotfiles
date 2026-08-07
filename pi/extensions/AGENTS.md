# Pi Extensions Notes

This directory contains project-local Pi extensions.

## Files

- `auto-session-name.ts`
  - Auto-renames the current Pi session using the cheapest available model, so the session selector reads like a to-do list instead of identical first lines.
  - On by default for every session; names after the first exchange and proactively on resume/reload/fork when a session has content but no name yet.
  - Re-evaluates every N user messages (`PI_AUTONAME_EVERY`, default 5) to track topic drift.
  - Runs only in the interactive TUI (never subagents/headless). Backs off permanently once it detects a name the user set themselves (`/name`, `--name`).
  - Picks the cheapest model with auth automatically; override via `/autoname model <id>`, `--autoname-model <id>`, or `$PI_AUTONAME_MODEL`.
  - Persists state as custom session entries so it survives `/reload`, `/resume`, and `/fork`.
  - `/autoname` command: `now` (force rename), `on` / `off`, `model <id>`, or no args for status.
  - Env/flags: `PI_AUTONAME_MODEL`, `PI_AUTONAME_EVERY`, `PI_AUTONAME_DEFAULT=off`, `PI_AUTONAME_DEBUG=1`.

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

## Operational notes

- After changes, run `/reload` in Pi to apply extension updates.
- Keep footer rendering lightweight: avoid expensive per-render shell commands.
- Prefer branch-change-triggered refresh + cached metadata for git/GitHub info.

## Package manifest (`pi/package.json`)

The `pi` field in `package.json` explicitly declares extensions, skills, and
themes. **Once a `pi` manifest exists, convention-based auto-discovery is
disabled** — pi only loads what is listed. If you add a new extension, skill
directory, or theme file, you must also add it to the corresponding array in
the manifest or it will not be loaded.
