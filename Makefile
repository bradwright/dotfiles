SOURCE	:= $(shell pwd)
TARGET	:= ~
FILES	:= .bashrc .bash_profile .tmux.conf .gitconfig .ackrc .zshrc .screenrc .inputrc

all: clean install

install:
	@for f in $(FILES); do \
		ln -sf $(SOURCE)/$$f $(TARGET)/$$f; \
	done
	@mkdir -p ~/.ssh/
	@chmod 700 ~/.ssh/
	@ln -sf $(SOURCE)/.sshrc ~/.ssh/rc

clean:
	@for f in $(FILES); do \
		rm -f $(TARGET)/$$f; \
	done
	@rm $(TARGET)/.ssh/rc
