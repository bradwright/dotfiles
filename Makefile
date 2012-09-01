SOURCE	:= $(CURDIR)
TARGET	:= $(HOME)
FILES	:= bashrc bash_profile tmux.conf gitconfig gitignore ackrc zshrc screenrc inputrc

all: clean install

git_submodule:
	git submodule update --init

install_emacs: git_submodule
	$(MAKE) -C emacs.d all

clean_emacs:
	$(MAKE) -C emacs.d clean

install: git_submodule
	@for f in $(FILES); do \
		ln -sf $(SOURCE)/$$f $(TARGET)/.$$f; \
	done
	@mkdir -p ~/.ssh/
	@chmod 700 ~/.ssh/
	@ln -sf $(SOURCE)/.sshrc ~/.ssh/rc

clean: clean_emacs
	@-for f in $(FILES); do \
		rm -f $(TARGET)/$$f; \
	done
	@-rm $(TARGET)/.ssh/rc
