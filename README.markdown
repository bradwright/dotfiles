dotfiles
========

Personal macOS dotfiles and related config.

What lives here
---------------

This repo is centered around a `Makefile` that symlinks config into `$HOME`.
It currently manages:

- shell dotfiles at the repo root:
  - `aliases` → `~/.aliases`
  - `local_gitconfig` → `~/.local_gitconfig`
  - `gitignore` → `~/.gitignore`
  - `zshrc` → `~/.zshrc`
  - `zshenv` → `~/.zshenv`
- `ghostty/` → `~/.config/ghostty`
- `iterm2/themes/solarized-dark-custom.itermcolors` → iTerm2's `Custom Color Presets`
- `starship.toml` → `~/.config/starship.toml`
- `fish/config.fish` and `fish/fish_plugins` → `~/.config/fish/`
- `nvim/init.lua`, `nvim/ftplugin/gitcommit.lua`, and `nvim/colors/` →
  `~/.config/nvim/`
- `atuin/config.toml` → `~/.config/atuin/config.toml`
- `pi/settings.json` merged into `~/.pi/agent/settings.json`
- `codex/themes/solarized-dark-custom.json` merged into
  `~/.codex/config.toml` as the Codex desktop dark theme

The repo also contains:

- `Brewfile` for Homebrew packages
- `scripts/` and `patches/` for applying and rolling back local pi patches
- `pi/`, a separate pi package with extensions, skills, themes, and custom
  agents
- `codex/`, Codex app theme assets

Installation
------------

Install the dotfiles managed by the `Makefile`:

```sh
make install
```

That will:

- create/update the symlinks listed above
- create `~/.hushlogin`
- import the Solarized Dark custom color preset into iTerm2
- generate `~/.config/fish/starship.toml` from the main `starship.toml`
- merge the versioned `pi/settings.json` into `~/.pi/agent/settings.json`
  while preserving keys that pi manages locally
- merge the Solarized Dark custom Codex theme into `~/.codex/config.toml`
  while preserving providers, project trust, MCP servers, and other local
  Codex settings

To remove the installed symlinks and generated files:

```sh
make clean
```

Pi package
----------

The `pi/` directory is not installed by `make install` as a pi package. To
install the package itself, run:

```sh
./pi/install.sh
```

That script:

- runs `pi install pi/`
- copies custom agent definitions from `pi/agents/` into
  `~/.pi/agent/agents/`
- installs the companion package `npm:@tintinweb/pi-subagents`

Notes
-----

This repo used to be called `homedir`, and originally started from
[Norm's `homedir`](https://github.com/norm/homedir), but it has diverged well
beyond that point.
