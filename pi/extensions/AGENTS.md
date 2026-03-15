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

- `model-identity.ts`
  - Appends active model id to system prompt for model self-identification tasks.

## Operational notes

- After changes, run `/reload` in Pi to apply extension updates.
- Dotfiles install symlinks this directory into `~/.pi/agent/extensions/` via `make install_pi`.
- Keep footer rendering lightweight: avoid expensive per-render shell commands.
- Prefer branch-change-triggered refresh + cached metadata for git/GitHub info.
