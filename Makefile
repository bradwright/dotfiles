SOURCE		:= $(CURDIR)
TARGET		:= $(HOME)
FILES		:= bashrc bash_profile aliases functions gitconfig gitignore ackrc zshrc zshenv screenrc inputrc irbrc

SUBL_TARGET := "$(HOME)/Library/Application Support/Sublime Text 2/Packages/User"
UNAME		:= $(shell uname)

.PHONY: git_submodule install clean

all: clean install

git_submodule:
	git submodule update --init

install_subl-Darwin:
	$(MAKE) SUBL_TARGET="$(HOME)/Library/Application Support/Sublime Text 2/Packages/User" install_subl

install_subl-Linux:
	$(warning "No target for Linux yet")

subl: install_subl-$(UNAME)

install_subl:
	$(MAKE) SUBL_TARGET="$(SUBL_TARGET)" clean_subl
	@ln -sf $(CURDIR)/sublimetext.d "$(SUBL_TARGET)"

clean_subl:
	@rm -rf "$(SUBL_TARGET)"

install_tmux:
	ln -sf $(CURDIR)/tmux-$(UNAME).conf $(TARGET)/.tmux.conf
	ln -sf $(CURDIR)/tmux.conf $(TARGET)/.tmux-all.conf

clean_tmux:
	@-unlink $(TARGET)/.tmux.conf
	@-unlink $(TARGET)/.tmux-all.conf

install_dotfiles:
	@for f in $(FILES); do \
		ln -sf $(SOURCE)/$$f $(TARGET)/.$$f; \
	done
	@mkdir -p ~/.ssh/
	@chmod 700 ~/.ssh/
	@ln -sf $(SOURCE)/sshrc ~/.ssh/rc

clean_dotfiles:
	@-for f in $(FILES); do \
		unlink $(TARGET)/.$$f; \
	done
	@-unlink $(TARGET)/.ssh/rc

install: subl install_dotfiles install_tmux

clean: clean_subl clean_tmux clean_dotfiles
