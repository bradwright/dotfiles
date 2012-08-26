Home directory
==============

This basically exists to set up my OS X command line environment to
something sensible, which means:

* Set up Emacs
  * Set `EDITOR` and `VISUAL` to the right `emacsclient`
  * Make sure that `emacs -nw` etc. launches the correct Emacs (OS X
    ships with version 22 - the current version is 24.1)
* Set up some [Homebrew](https://github.com/mxcl/homebrew) paths
  * Install `bash-completion`
* Do the right thing for [rbenv](https://github.com/sstephenson/rbenv)
* Add some sensible Git defaults (such as `autorebase`)

It also deals with the OS X `bashrc` vs `bash_profile` issue (it's the
reverse of how they're executed on Linux).

Also included are `tmux` and `screen` configuration for when I need to
set up a remote machine.

## Formerly known as `homedir`

This used to be called `homedir`, and was based on
[Norm's `homedir`](https://github.com/norm/homedir), but has since
stopped bearing enough resemblance to that to be called a fork, hence
it's a new repository.
