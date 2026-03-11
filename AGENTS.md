# Agent Guidelines for dotfiles

This repository contains personal dotfiles for macOS. The following rules
apply to any agent working in this repo.

## What this repo is

A flat collection of configuration files that are symlinked into `$HOME` (with
a leading dot prepended) by running `make install`. The `Makefile` is the
single source of truth for which files get installed and where.

Special install destinations:
- `sshrc` → `~/.ssh/rc`
- `ghostty-config` → `~/Library/Application Support/com.mitchellh.ghostty/config`
- `pi/settings.json` → `~/.pi/agent/settings.json`
- `pi/themes/*.json` → `~/.pi/agent/themes/*.json`

## Adding a new dotfile

1. Create the file at the **repo root** with no leading dot (e.g. `tmux.conf`,
   not `.tmux.conf`).
2. Add its name to the `FILES` variable in `Makefile` (space-separated list).
3. Add a corresponding `unlink` line in the `clean_dotfiles` target.
4. If the install destination is non-standard (not `~/.<filename>`), add
   explicit `ln -sf` and `unlink` lines in `install_dotfiles` /
   `clean_dotfiles` rather than using the loop.

## Shell file conventions

- Begin every shell file with an Emacs file-local mode line as the first line:
  ```sh
  # -*- mode: sh -*-
  ```
  For non-sh files use the appropriate mode (e.g. `# -*- mode: ruby -*-` for
  `Brewfile`, `# -*- mode: conf-unix -*-` for git config files).
- Shell functions and aliases must be compatible with **both bash and zsh**
  unless they live in a zsh-specific file (i.e. `zshrc` or `zshenv`).
- Prefer `source_if_exists` (defined in `functions`) over bare `source` /
  `.` calls to avoid hard failures on missing optional files.
- Use `prepend_path` / `append_path` (defined in `functions`) instead of
  directly mutating `$PATH`.
- Group related settings with a short comment explaining *why*, not just
  *what*, mirroring the style already in the files.

## Platform assumptions

- **Primary target is macOS (Darwin).** Linux compatibility is maintained
  where practical but macOS takes priority.
- Homebrew is always available. Use `brew --prefix` rather than hardcoding
  `/usr/local` or `/opt/homebrew` — the prefix differs between Intel and
  Apple Silicon Macs.
- Guard Linux-specific code with `[ $UNAME = Linux ]` checks, following the
  pattern in `functions`.

## Editor

- The configured `$EDITOR` / `$VISUAL` is `emacsclient` (`et` / `ec`).
- `GIT_EDITOR` is set to `vim +star` — do not change this.
- Do not introduce hard dependencies on VS Code, nano, or other editors.

## Package management

- Homebrew packages are tracked in `Brewfile`. Add any new CLI tool or cask
  there rather than installing ad-hoc.
- `brew install <package>` is pre-approved and may be run without asking.
- Node is managed via **nvm** (lazy-loaded through the `zsh-nvm` antigen
  plugin). Do not add a hardcoded Node path to `PATH`.
- Ruby is managed via **rbenv**. Do not add a hardcoded Ruby path.

## Git hygiene

- `branch.autosetuprebase = always` is set globally — all local branches
  rebase by default. Keep commits clean and rebased; avoid merge commits.
- `push.default = tracking` — push only tracks the upstream branch.
- Use `git commit --verbose` (already the default via `commit.verbose = true`)
  so diffs are visible during commit message authoring.

## Testing / verification

There is no automated test suite. After making changes, verify correctness by:

1. Running `make install` in a dry-run sense (review the Makefile targets
   before executing on a live system).
2. Sourcing the modified file in a subshell to check for syntax errors:
   ```sh
   zsh -n <file>   # syntax check only
   bash -n <file>  # for bash-compatible files
   ```
3. For `Brewfile` changes, validate with `brew bundle check`.

## What not to do

- Do **not** rename existing files — they are referenced by name in `Makefile`
  and in `source_if_exists` calls scattered across other dotfiles.
- Do **not** add secrets, tokens, or credentials to any file in this repo.
  Machine-local overrides belong in `~/.local_zshrc`, `~/.local_zshenv`,
  etc., which are sourced by the main files but are intentionally absent from
  the repo.
- Do **not** install system-level packages (e.g. via `sudo apt-get`) — use
  Homebrew and update `Brewfile`.
- Do **not** modify `pi/settings.json` unless explicitly asked — it controls
  the live AI coding agent configuration.
