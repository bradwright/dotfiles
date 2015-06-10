SOURCE		:= $(CURDIR)
TARGET		:= $(HOME)
FILES		:= bashrc bash_profile aliases functions local_gitconfig gitignore ackrc zshrc zshenv screenrc inputrc irbrc slate.js gemrc sbtconfig vimrc

UNAME		:= $(shell uname)

.PHONY: git_submodule install clean

all: clean install

git_submodule:
	git submodule update --init

install_tmux:
	@ln -sf $(CURDIR)/tmux-$(UNAME).conf $(TARGET)/.tmux.conf
	@ln -sf $(CURDIR)/tmux.conf $(TARGET)/.tmux-all.conf

clean_tmux:
	@-unlink $(TARGET)/.tmux.conf
	@-unlink $(TARGET)/.tmux-all.conf

install_dotfiles:
	@for f in $(FILES); do \
		ln -sf $(SOURCE)/$$f $(TARGET)/.$$f; \
	done
	@ln -sf $(SOURCE)/bin $(TARGET)/
	@mkdir -p ~/.ssh/
	@chmod 700 ~/.ssh/
	@ln -sf $(SOURCE)/sshrc ~/.ssh/rc
	@ln -sf $(SOURCE)/vim $(TARGET)/

clean_dotfiles:
	@-for f in $(FILES); do \
		unlink $(TARGET)/.$$f; \
	done
	@-unlink $(TARGET)/.ssh/rc
	@-unlink $(TARGET)/bin
	@-unlink $(TARGET)/vim

install: install_dotfiles install_tmux

clean: clean_tmux clean_dotfiles
