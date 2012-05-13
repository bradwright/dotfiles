all: install

install:
	@ln -s `pwd`/.bashrc ~/
	@ln -s `pwd`/.bash_profile ~/
	@ln -s `pwd`/bin ~/
