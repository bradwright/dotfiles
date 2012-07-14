# ~/.bashrc
#

# If not running interactively, don't do anything
[ -z "$PS1" ] && return

# don't put duplicate lines in the history. See bash(1) for more options
# ... or force ignoredups and ignorespace
HISTCONTROL=ignoredups:ignorespace

# append to the history file, don't overwrite it
shopt -s histappend

# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)
HISTSIZE=1000
HISTFILESIZE=2000

# check the window size after each command and, if necessary,
# update the values of LINES and COLUMNS.
shopt -s checkwinsize

export EDITOR="emacsclient -nw"
export VISUAL="$EDITOR"
export TERM='xterm-256color'

# Add directory to PATH if it exists and is not already there.
# TODO: abstract "in path" out to a function
prepend_path() {
    to_add=$1
    if [ -d $to_add ]; then
        export PATH=$to_add:$PATH
    fi
}

append_path() {
    to_add=$1
    if [ -d $to_add ]; then
        export PATH=$PATH:$to_add
    fi
}

find_emacs() {
    # finds my Emacs install
    if [ `uname` = "Darwin" ]; then
        if [ -d /usr/local/Cellar/emacs ]; then
            dir="/usr/local/Cellar/emacs"
            emacsen=$(find "$dir" -name Emacs -type f | head -n 1)
        fi

        if [ -n "$emacsen" ]; then
            emacsbin=$(find "$dir" -name emacs -type f | head -n 1)

            if [ ! -e "$emacsbin" ]; then
                alias emacs="$emacsen"
            fi

            emacsclient=$(find "$dir" -name emacsclient -type f | head -n 1)
            emacsdir=$(dirname $emacsclient)
            prepend_path $emacsdir
        fi
    fi
}

find_git() {
    # it's recommended *not* to put /usr/local/bin before /usr/bin
    # because there might be system dependencies - however if I don't
    # do something, XCode's Git ends up before my custom one in the
    # path.
    if [ -e /usr/local/bin/git ]; then
        git=$(readlink /usr/local/bin/git)
        gitdir=$(dirname $git)
        prepend_path "/usr/local/bin/$gitdir"
    fi
}

find_brew() {
    # explicitly put homebrew bin in PATH, as other shells might not
    # find it
    if [ `uname` = "Darwin" ]; then
        brewpath=$(command -v brew)
        brewdir=$(dirname $brewpath)
        append_path $brewdir
    fi
}

find_completion() {
    # enable programmable completion features (you don't need to enable
    # this, if it's already enabled in /etc/bash.bashrc and /etc/profile
    # sources /etc/bash.bashrc).
    if [ -f /etc/bash_completion ] && ! shopt -oq posix; then
        . /etc/bash_completion
    fi
    if [ `uname` = "Darwin" ]; then
        if [ -f `brew --prefix`/etc/bash_completion ]; then
            . `brew --prefix`/etc/bash_completion
        fi
    fi
}

find_ruby() {
    # Ruby libraries
    # check for rbenv first
    if command -v rbenv > /dev/null; then
        if [ -d $HOME/.rbenv/shims ]; then
            append_path $HOME/.rbenv/shims
        fi
        if [ -d $HOME/.rbenv/bin ]; then
            prepend_path $HOME/.rbenv/bin
        fi
        eval "$(rbenv init -)"
    elif [ -d $HOME/.rvm/bin ]; then
        append_path $HOME/.rvm/bin
        [[ -s "$HOME/.rvm/scripts/rvm" ]] && source "$HOME/.rvm/scripts/rvm"
    fi
    # shortcut for making local bundles
    alias bl="bundle install --path vendor/bundle"
    alias bi="bundle install"
}

find_emacs
find_git
find_brew
find_completion
find_ruby

# local changes
if [ -f ~/.local_bashrc ]; then
    . ~/.local_bashrc
fi

export PATH
