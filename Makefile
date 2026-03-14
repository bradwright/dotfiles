SOURCE		:= $(CURDIR)
TARGET		:= $(HOME)
FILES		:= aliases local_gitconfig gitignore zshrc zshenv

.PHONY: install clean

all: clean install

install_dotfiles:
	@for f in $(FILES); do \
		ln -sf $(SOURCE)/$$f $(TARGET)/.$$f; \
	done
	@touch $(TARGET)/.hushlogin
	@mkdir -p ~/Library/Application\ Support/com.mitchellh.ghostty/
	@ln -sf $(SOURCE)/ghostty-config ~/Library/Application\ Support/com.mitchellh.ghostty/config
	@mkdir -p ~/.config/
	@ln -sf $(SOURCE)/starship.toml $(TARGET)/.config/starship.toml
	@mkdir -p ~/.config/fish/
	@ln -sf $(SOURCE)/fish/config.fish ~/.config/fish/config.fish
	@ln -sf $(SOURCE)/fish/fish_plugins ~/.config/fish/fish_plugins
	@mkdir -p ~/.config/nvim/ftplugin/
	@ln -sf $(SOURCE)/nvim/init.lua ~/.config/nvim/init.lua
	@ln -sf $(SOURCE)/nvim/ftplugin/gitcommit.lua ~/.config/nvim/ftplugin/gitcommit.lua
	@mkdir -p ~/.pi/agent/themes/
	@# Merge managed settings into the live file, but keep Pi-managed runtime keys.
	@# This avoids noisy git diffs when Pi updates default model/provider or changelog version.
	@tmp=$$(mktemp); \
	if [ -f ~/.pi/agent/settings.json ]; then \
		jq -s ' \
			(.[0] // {}) as $$repo | \
			(.[1] // {}) as $$live | \
			($$live * $$repo) \
			| .defaultModel = ($$live.defaultModel // .defaultModel) \
			| .defaultProvider = ($$live.defaultProvider // .defaultProvider) \
			| .lastChangelogVersion = ($$live.lastChangelogVersion // .lastChangelogVersion) \
		' $(SOURCE)/pi/settings.json ~/.pi/agent/settings.json > $$tmp; \
	else \
		cp $(SOURCE)/pi/settings.json $$tmp; \
	fi; \
	mv $$tmp ~/.pi/agent/settings.json
	@ln -sf $(SOURCE)/pi/themes/warp.json ~/.pi/agent/themes/warp.json
	@ln -sf $(SOURCE)/pi/themes/solarized-dark.json ~/.pi/agent/themes/solarized-dark.json
	@ln -sf $(SOURCE)/pi/themes/solarized-light.json ~/.pi/agent/themes/solarized-light.json

clean_dotfiles:
	@-for f in $(FILES); do \
		unlink $(TARGET)/.$$f; \
	done
	@-rm -f $(TARGET)/.hushlogin
	@-unlink ~/Library/Application\ Support/com.mitchellh.ghostty/config
	@-unlink ~/.config/starship.toml
	@-unlink ~/.config/fish/config.fish
	@-unlink ~/.config/fish/fish_plugins
	@-unlink ~/.config/nvim/init.lua
	@-unlink ~/.config/nvim/ftplugin/gitcommit.lua
	@-unlink ~/.pi/agent/settings.json
	@-unlink ~/.pi/agent/themes/warp.json
	@-unlink ~/.pi/agent/themes/solarized-dark.json
	@-unlink ~/.pi/agent/themes/solarized-light.json

install: install_dotfiles

clean: clean_dotfiles
