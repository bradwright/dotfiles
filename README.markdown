Home directory
==============

This repo sets up my macOS command-line environment.

It includes:

* Emacs-friendly editor defaults (`EDITOR` / `VISUAL`)
* Homebrew-based PATH and shell completion setup
* rbenv and language/tooling PATH glue
* Git defaults and shell aliases/functions

## Installing pbcopy/pbpaste Launch Daemons

Copy the XML out of `bin/rpbcopy` and `bin/rpbpaste` into files named:

* `~/Library/LaunchAgents/localhost.pbcopy.plist` and
* `~/Library/LaunchAgents/localhost.pbpaste.plist` respectively.

Then run:

    launchctl load ~/Library/LaunchAgents/pbcopy.plist
    launchctl load ~/Library/LaunchAgents/pbpaste.plist

to start the daemons. For more information please see
[remote pbcopy](http://seancoates.com/blogs/remote-pbcopy).

## Formerly known as `homedir`

This used to be called `homedir`, and was based on
[Norm's `homedir`](https://github.com/norm/homedir), but has since
stopped bearing enough resemblance to that to be called a fork, hence
it's a new repository.
