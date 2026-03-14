SOURCE		:= $(CURDIR)
TARGET		:= $(HOME)

# Shell dotfiles symlinked as ~/.<name>
FILES		:= aliases local_gitconfig gitignore zshrc zshenv

.PHONY: install clean all \
	install_shell clean_shell \
	install_ghostty clean_ghostty \
	install_starship clean_starship \
	install_fish clean_fish \
	install_nvim clean_nvim \
	install_pi clean_pi

all: clean install

# --- Aggregate targets ---

install: install_shell install_ghostty install_starship install_fish install_nvim install_pi

clean: clean_shell clean_ghostty clean_starship clean_fish clean_nvim clean_pi

# --- Shell ---

install_shell:
	@for f in $(FILES); do \
		ln -sf $(SOURCE)/$$f $(TARGET)/.$$f; \
	done
	@touch $(TARGET)/.hushlogin

clean_shell:
	@-for f in $(FILES); do \
		unlink $(TARGET)/.$$f; \
	done
	@-rm -f $(TARGET)/.hushlogin

# --- Ghostty ---

install_ghostty:
	@mkdir -p ~/Library/Application\ Support/com.mitchellh.ghostty/
	@ln -sf $(SOURCE)/ghostty-config ~/Library/Application\ Support/com.mitchellh.ghostty/config

clean_ghostty:
	@-unlink ~/Library/Application\ Support/com.mitchellh.ghostty/config

# --- Starship ---

install_starship:
	@mkdir -p $(TARGET)/.config/
	@ln -sf $(SOURCE)/starship.toml $(TARGET)/.config/starship.toml

clean_starship:
	@-unlink $(TARGET)/.config/starship.toml

# --- Fish ---

install_fish:
	@mkdir -p $(TARGET)/.config/fish/
	@ln -sf $(SOURCE)/fish/config.fish $(TARGET)/.config/fish/config.fish
	@ln -sf $(SOURCE)/fish/fish_plugins $(TARGET)/.config/fish/fish_plugins

clean_fish:
	@-unlink $(TARGET)/.config/fish/config.fish
	@-unlink $(TARGET)/.config/fish/fish_plugins

# --- Neovim ---

install_nvim:
	@mkdir -p $(TARGET)/.config/nvim/ftplugin/
	@ln -sf $(SOURCE)/nvim/init.lua $(TARGET)/.config/nvim/init.lua
	@ln -sf $(SOURCE)/nvim/ftplugin/gitcommit.lua $(TARGET)/.config/nvim/ftplugin/gitcommit.lua

clean_nvim:
	@-unlink $(TARGET)/.config/nvim/init.lua
	@-unlink $(TARGET)/.config/nvim/ftplugin/gitcommit.lua

# --- Pi ---

install_pi:
	@mkdir -p $(TARGET)/.pi/agent/themes/
	@mkdir -p $(TARGET)/.pi/agent/skills/
	@mkdir -p $(TARGET)/.pi/agent/extensions/
	@# Merge managed settings into the live file, but keep Pi-managed runtime keys.
	@# This avoids noisy git diffs when Pi updates default model/provider or changelog version.
	@tmp=$$(mktemp); \
	if [ -f $(TARGET)/.pi/agent/settings.json ]; then \
		jq -s ' \
			(.[0] // {}) as $$repo | \
			(.[1] // {}) as $$live | \
			($$live * $$repo) \
			| .defaultModel = ($$live.defaultModel // .defaultModel) \
			| .defaultProvider = ($$live.defaultProvider // .defaultProvider) \
			| .lastChangelogVersion = ($$live.lastChangelogVersion // .lastChangelogVersion) \
		' $(SOURCE)/pi/settings.json $(TARGET)/.pi/agent/settings.json > $$tmp; \
	else \
		cp $(SOURCE)/pi/settings.json $$tmp; \
	fi; \
	mv $$tmp $(TARGET)/.pi/agent/settings.json
	@# Sync all repo-managed skills into ~/.pi/agent/skills.
	@# First prune stale managed symlinks, then link current repo skills.
	@if [ -d $(TARGET)/.pi/agent/skills ]; then \
		for skill in $(TARGET)/.pi/agent/skills/*; do \
			[ -L "$$skill" ] || continue; \
			src=$$(readlink "$$skill"); \
			case "$$src" in \
				$(SOURCE)/pi/skills/*) [ -e "$$src" ] || unlink "$$skill" ;; \
			esac; \
		done; \
	fi
	@if [ -d $(SOURCE)/pi/skills ]; then \
		for skill in $(SOURCE)/pi/skills/*; do \
			[ -e "$$skill" ] || continue; \
			ln -sfn "$$skill" "$(TARGET)/.pi/agent/skills/$$(basename "$$skill")"; \
		done; \
	fi
	@# Sync all repo-managed extensions into ~/.pi/agent/extensions.
	@# First prune stale managed symlinks, then link current repo extensions.
	@if [ -d $(TARGET)/.pi/agent/extensions ]; then \
		for ext in $(TARGET)/.pi/agent/extensions/*; do \
			[ -L "$$ext" ] || continue; \
			src=$$(readlink "$$ext"); \
			case "$$src" in \
				$(SOURCE)/pi/extensions/*) [ -e "$$src" ] || unlink "$$ext" ;; \
			esac; \
		done; \
	fi
	@if [ -d $(SOURCE)/pi/extensions ]; then \
		for ext in $(SOURCE)/pi/extensions/*; do \
			[ -e "$$ext" ] || continue; \
			ln -sfn "$$ext" "$(TARGET)/.pi/agent/extensions/$$(basename "$$ext")"; \
		done; \
	fi
	@# Sync all repo-managed themes into ~/.pi/agent/themes.
	@# First prune stale managed symlinks, then link current repo themes.
	@if [ -d $(TARGET)/.pi/agent/themes ]; then \
		for theme in $(TARGET)/.pi/agent/themes/*; do \
			[ -L "$$theme" ] || continue; \
			src=$$(readlink "$$theme"); \
			case "$$src" in \
				$(SOURCE)/pi/themes/*) [ -e "$$src" ] || unlink "$$theme" ;; \
			esac; \
		done; \
	fi
	@if [ -d $(SOURCE)/pi/themes ]; then \
		for theme in $(SOURCE)/pi/themes/*; do \
			[ -e "$$theme" ] || continue; \
			ln -sfn "$$theme" "$(TARGET)/.pi/agent/themes/$$(basename "$$theme")"; \
		done; \
	fi

clean_pi:
	@-unlink $(TARGET)/.pi/agent/settings.json
	@-if [ -d $(TARGET)/.pi/agent/extensions ]; then \
		for ext in $(TARGET)/.pi/agent/extensions/*; do \
			[ -L "$$ext" ] || continue; \
			src=$$(readlink "$$ext"); \
			case "$$src" in \
				$(SOURCE)/pi/extensions/*) unlink "$$ext" ;; \
			esac; \
		done; \
	fi
	@-if [ -d $(TARGET)/.pi/agent/skills ]; then \
		for skill in $(TARGET)/.pi/agent/skills/*; do \
			[ -L "$$skill" ] || continue; \
			src=$$(readlink "$$skill"); \
			case "$$src" in \
				$(SOURCE)/pi/skills/*) unlink "$$skill" ;; \
			esac; \
		done; \
	fi
	@-if [ -d $(TARGET)/.pi/agent/themes ]; then \
		for theme in $(TARGET)/.pi/agent/themes/*; do \
			[ -L "$$theme" ] || continue; \
			src=$$(readlink "$$theme"); \
			case "$$src" in \
				$(SOURCE)/pi/themes/*) unlink "$$theme" ;; \
			esac; \
		done; \
	fi
