SOURCE		:= $(CURDIR)
TARGET		:= $(HOME)
FILES		:= bashrc bash_profile aliases functions local_gitconfig gitignore ackrc zshrc zshenv screenrc inputrc irbrc slate.js gemrc sbtconfig

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

clean_dotfiles:
	@-for f in $(FILES); do \
		unlink $(TARGET)/.$$f; \
	done
	@-unlink $(TARGET)/.ssh/rc
	@-unlink $(TARGET)/bin

install_private_xml:
	@ln -sf $(SOURCE)/keyremap4macbook/private.xml ~/Library/Application\ Support/KeyRemap4MacBook/

clean_private_xml:
	@unlink ~/Library/Application\ Support/KeyRemap4MacBook/private.xml

install: install_dotfiles install_tmux install_private_xml

clean: clean_tmux clean_dotfiles clean_private_xml
