SOURCE	:= $(shell pwd)
TARGET	:= ~
FILES	:= .bashrc .bash_profile .tmux.conf .gitconfig .ackrc .zshrc .screenrc

all: install

install:
	@for f in $(FILES); do \
		ln -sf $(SOURCE)/$$f $(TARGET)/$$f; \
	done
