SOURCE		:= $(CURDIR)
TARGET		:= $(HOME)
FILES		:= bashrc bash_profile tmux.conf gitconfig gitignore ackrc zshrc screenrc inputrc irbrc
SUBL_TARGET := "$(HOME)/Library/Application Support/Sublime Text 2/Packages/User"

.PHONY: git_submodule install_emacs clean_emacs install clean

all: clean install

git_submodule:
	git submodule update --init

install_emacs: git_submodule
	$(MAKE) -C emacs.d all

clean_emacs:
	$(MAKE) -C emacs.d clean

install_subl: clean_subl
	@ln -sf $(CURDIR)/sublimetext.d $(SUBL_TARGET)

clean_subl:
	@rm -rf $(SUBL_TARGET)

install: git_submodule install_emacs install_subl
	@for f in $(FILES); do \
		ln -sf $(SOURCE)/$$f $(TARGET)/.$$f; \
	done
	@mkdir -p ~/.ssh/
	@chmod 700 ~/.ssh/
	@ln -sf $(SOURCE)/.sshrc ~/.ssh/rc

clean: clean_emacs clean_subl
	@-for f in $(FILES); do \
		unlink $(TARGET)/$$f; \
	done
	@-unlink $(TARGET)/.ssh/rc
