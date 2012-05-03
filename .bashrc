# ~/.bashrc
#
# We just want Emacs really

if [ `uname` = 'Darwin' ]; then
    # check all 3 places we might have Emacs set up
    dir="$HOME/Applications"
    emacsen=$(find "$dir" -name Emacs | head -n 1)

    if [ -z "$emacsen" ]; then
        dir="/Applications"
        emacsen=$(find "$dir" -name Emacs | head -n 1)
    fi

    if [ -z "$emacsen" ] && [ -d /usr/local/Cellar/emacs ]; then
        dir="/usr/local/Cellar/emacs"
        emacsen=$(find "$dir" -name Emacs | head -n 1)
    fi

    if [ -n "$emacsen" ]; then
        alias emacs="$emacsen"
        emacsclient=$(find "$dir" -name emacsclient | head -n 1)
        emacsdir=$(dirname $emacsclient)
        PATH="$emacsdir:$PATH"
        export EDITOR="emacsclient"
        export VISUAL="emacsclient"
    fi

    # some homebrew path mangling

    # it's recommended *not* to put /usr/local/bin before /usr/bin
    # because there might be system dependencies - however if I don't
    # do something, XCode's Git ends up before my custom one in the
    # path.
    if [ -e /usr/local/bin/git ]; then
        # we have a homebrew Git, link that in to the $PATH
        git=$(readlink /usr/local/bin/git)
        gitdir=$(dirname $git)
        # TODO: this path is messy, it's full of ../stuff
        PATH="/usr/local/bin/$gitdir:$PATH"
    fi

    export PATH
fi

# RVM

if [ -s "$HOME/.rvm/scripts/rvm" ]; then
    source "$HOME/.rvm/scripts/rvm"
    . "$HOME/.rvm/scripts/rvm"
fi
