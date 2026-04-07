# Agent Guidelines for dotfiles

This repository contains personal macOS dotfiles plus a pi package. The
following rules apply to any agent working in this repo.

## What this repo is

The `Makefile` is the source of truth for what `make install` manages and where
it gets installed.

Today, `make install` manages:

- **Shell dotfiles** at the repo root — symlinked as `~/.<name>` via the
  `FILES` variable:
  - `aliases`
  - `local_gitconfig`
  - `gitignore`
  - `zshrc`
  - `zshenv`
- **`ghostty/`** — symlinked to `~/.config/ghostty`
- **`starship.toml`** — symlinked to `~/.config/starship.toml`
- **`fish/config.fish`** and **`fish/fish_plugins`** — symlinked into
  `~/.config/fish/`
- **Fish Starship config** — generated at `~/.config/fish/starship.toml` from
  the repo's `starship.toml`
- **Neovim config**:
  - `nvim/init.lua` → `~/.config/nvim/init.lua`
  - `nvim/ftplugin/gitcommit.lua` → `~/.config/nvim/ftplugin/gitcommit.lua`
  - `nvim/colors` → `~/.config/nvim/colors`
- **Pi settings** — `pi/settings.json` is merged into
  `~/.pi/agent/settings.json`, preserving locally managed pi keys

The repo also contains:

- **`Brewfile`** — Homebrew packages and casks
- **`scripts/`** — helper scripts for applying and rolling back local pi
  patches
- **`patches/`** — patch files consumed by those scripts
- **`pi/`** — a pi package containing extensions, skills, themes, install
  script, and custom agent definitions
- **`CLAUDE.md`** — Claude-specific repo instructions
- **`.pi/`** — local planning/build artifacts; not part of dotfile install

## Adding a new dotfile

If the new file should be installed by `make install`:

1. Create the file in the repo.
2. Update `Makefile` so installation behavior is explicit.
3. Add matching cleanup logic to the corresponding `clean_*` target.
4. Wire the target into the aggregate `install` / `clean` targets if needed.

For root-level shell dotfiles that should install as `~/.<name>`:

1. Create the file at the **repo root** with no leading dot.
2. Add its name to `FILES` in `Makefile`.
3. Ensure `clean_shell` will remove the installed symlink.

For nonstandard destinations, follow the existing target pattern used by
`install_ghostty`, `install_starship`, `install_fish`, `install_nvim`, and
`install_pi`.

## Shell file conventions

- Begin every shell file with an Emacs file-local mode line as the first line:
  ```sh
  # -*- mode: sh -*-
  ```
  For fish files use `# -*- mode: fish -*-`. For non-shell files use the
  appropriate mode (for example `# -*- mode: ruby -*-` for `Brewfile` and
  `# -*- mode: conf-unix -*-` for git config files).
- Shell functions and aliases in `aliases` must be compatible with **both bash
  and zsh**. Zsh-specific code belongs in `zshrc` or `zshenv`. Fish-specific
  code belongs in `fish/config.fish`.
- Use guarded sourcing for optional files so missing local overrides do not
  break startup.
- In zsh files, prefer native `path` array manipulation (`typeset -U path`) to
  deduplicate entries cleanly.
- Group related settings with short comments that explain *why*, not just
  *what*.

## Platform assumptions

- **Primary target is macOS (Darwin).** Linux compatibility is nice to have,
  but macOS behavior wins when there is a tradeoff.
- Homebrew is always available. Use `brew --prefix` instead of hardcoding
  `/usr/local` or `/opt/homebrew`.
- Guard Linux-specific code with checks that match the style already used in
  the repo.

## Editor

- The configured `$EDITOR` / `$VISUAL` is `nvim`.
- `GIT_EDITOR` is set to `nvim +star` — do not change this.
- Neovim config in this repo currently consists of `nvim/init.lua`,
  `nvim/ftplugin/gitcommit.lua`, and `nvim/colors/`.
- Do not introduce hard dependencies on VS Code, nano, or other editors.

## Package management

- Homebrew packages belong in `Brewfile`.
- `brew install <package>` is pre-approved and may be run without asking.
- Node is managed via **nvm**; do not hardcode a Node install path into
  `PATH`.
- Fish plugins are managed via **fisher** and declared in
  `fish/fish_plugins`.
- Starship is used in both zsh and fish. Fish gets a generated variant of the
  main config during `make install`.

## Pi package and settings

There are two separate pi-related flows in this repo:

1. **`make install`** merges `pi/settings.json` into the user's global pi
   settings file at `~/.pi/agent/settings.json`, preserving keys that pi
   manages dynamically.
2. **`./pi/install.sh`** installs the `pi/` package itself, copies custom
   agent definitions from `pi/agents/` into `~/.pi/agent/agents/`, and installs
   the companion package `npm:@tintinweb/pi-subagents`.

When editing pi-related files:

- Extensions live under `pi/extensions/`
- Skills live under `pi/skills/`
- Themes live under `pi/themes/`
- Custom agents live under `pi/agents/`

After editing the pi package, reinstall it with `./pi/install.sh` if needed and
run `/reload` in pi to pick up changes.

## Git hygiene

- Keep commits clean and rebased.
- Avoid merge commits unless explicitly requested.
- Preserve existing file names unless the user explicitly asks for a rename.

## Testing / verification

There is no automated test suite. After making changes, verify correctness by:

1. Reviewing the relevant `Makefile` targets.
2. Syntax-checking modified shell files:
   ```sh
   zsh -n <file>
   bash -n <file>
   fish -n <file>
   ```
3. Running `brew bundle check` after `Brewfile` edits.
4. For `Makefile` changes, sanity-checking the affected install/clean behavior.

## What not to do

- Do **not** rename existing files unless explicitly asked.
- Do **not** add secrets, tokens, or credentials to the repo.
- Do **not** install system packages with tools like `apt`; use Homebrew.
- Do **not** overwrite user-specific pi state that is meant to stay local.
- Do **not** modify `pi/settings.json` unless the task actually calls for a pi
  configuration change.
