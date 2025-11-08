SOURCE		:= $(CURDIR)
TARGET		:= $(HOME)
FILES		:= bashrc bash_profile aliases finicky.js functions local_gitconfig gitignore ackrc zshrc zshenv inputrc irbrc gemrc hushlogin

UNAME		:= $(shell uname)
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

install_fzf:
	@$(BREW)/opt/fzf/install --all 1>/dev/null

clean_dotfiles:
	@-for f in $(FILES); do \
		unlink $(TARGET)/.$$f; \
	done
	@-unlink $(TARGET)/.ssh/rc
	@-unlink ~/Library/Application\ Support/com.mitchellh.ghostty/config

install: install_dotfiles install_fzf

clean: clean_tmux clean_dotfiles
