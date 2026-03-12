SOURCE		:= $(CURDIR)
TARGET		:= $(HOME)
FILES		:= aliases finicky.js functions local_gitconfig gitignore ackrc zshrc zshenv inputrc irbrc gemrc hushlogin

BREW		:= $(shell brew --prefix)

.PHONY: git_submodule install clean

all: clean install

git_submodule:
	git submodule update --init

install_dotfiles:
	@for f in $(FILES); do \
		ln -sf $(SOURCE)/$$f $(TARGET)/.$$f; \
	done
	@ln -sf $(SOURCE)/bin $(TARGET)/
	@mkdir -p ~/.ssh/
	@chmod 700 ~/.ssh/
	@ln -sf $(SOURCE)/sshrc ~/.ssh/rc
	@mkdir -p ~/Library/Application\ Support/com.mitchellh.ghostty/
	@ln -sf $(SOURCE)/ghostty-config ~/Library/Application\ Support/com.mitchellh.ghostty/config
	@mkdir -p ~/.config/
	@ln -sf $(SOURCE)/starship.toml $(TARGET)/.config/starship.toml
	@mkdir -p ~/.config/fish/
	@ln -sf $(SOURCE)/fish/config.fish ~/.config/fish/config.fish
	@ln -sf $(SOURCE)/fish/fish_plugins ~/.config/fish/fish_plugins
	@mkdir -p ~/.pi/agent/themes/
	@ln -sf $(SOURCE)/pi/settings.json ~/.pi/agent/settings.json
	@ln -sf $(SOURCE)/pi/themes/warp.json ~/.pi/agent/themes/warp.json
	@ln -sf $(SOURCE)/pi/themes/solarized-dark.json ~/.pi/agent/themes/solarized-dark.json
	@ln -sf $(SOURCE)/pi/themes/solarized-light.json ~/.pi/agent/themes/solarized-light.json

clean_dotfiles:
	@-for f in $(FILES); do \
		unlink $(TARGET)/.$$f; \
	done
	@-unlink $(TARGET)/.ssh/rc
	@-unlink ~/Library/Application\ Support/com.mitchellh.ghostty/config
	@-unlink ~/.config/starship.toml
	@-unlink ~/.config/fish/config.fish
	@-unlink ~/.config/fish/fish_plugins
	@-unlink ~/.pi/agent/settings.json
	@-unlink ~/.pi/agent/themes/warp.json
	@-unlink ~/.pi/agent/themes/solarized-dark.json
	@-unlink ~/.pi/agent/themes/solarized-light.json

install: install_dotfiles

clean: clean_dotfiles
