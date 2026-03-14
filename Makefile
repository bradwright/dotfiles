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
	@ln -sf $(SOURCE)/pi/themes/warp.json $(TARGET)/.pi/agent/themes/warp.json
	@ln -sf $(SOURCE)/pi/themes/solarized-dark.json $(TARGET)/.pi/agent/themes/solarized-dark.json
	@ln -sf $(SOURCE)/pi/themes/solarized-light.json $(TARGET)/.pi/agent/themes/solarized-light.json

clean_pi:
	@-unlink $(TARGET)/.pi/agent/settings.json
	@-unlink $(TARGET)/.pi/agent/themes/warp.json
	@-unlink $(TARGET)/.pi/agent/themes/solarized-dark.json
	@-unlink $(TARGET)/.pi/agent/themes/solarized-light.json
