# Most of this borrowed from:
# https://github.com/threedaymonk/config/blob/master/zshrc
autoload -Uz colors; colors

# Prefer Emacs keybindings
bindkey -e

# History configuration
# Ignore dupes and share history
setopt histignorealldups sharehistory
# Big history
HISTSIZE=1000
SAVEHIST=1000
HISTFILE=~/.zsh_history

export EDITOR="emacsclient -nw"
export VISUAL="$EDITOR"

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

# Show stuff in prompt
precmd() {
    exit_status=$?

    # Clear all colours
    clr="%b%f%k"

    PS1="%F{magenta}%m %F{green}%~ %#${clr} "

    if git branch >& /dev/null; then
        PS1="%F{black}%K{yellow} $(git branch --no-color | grep '^*' | cut -d ' ' -f 2-) ${clr} ${PS1}"
    fi

    if [ $RUBY_VERSION ]; then
        PS1="%F{black}%K{red} ${RUBY_VERSION} ${clr} ${PS1}"
    fi

    if test $exit_status -ne 0; then
        PS1="%F{white}%K{red} ${exit_status} ${clr} ${PS1}"
    fi
}

PS2="%F{$prompt_fg}%K{$prompt_bg}${PS2}%f%k"
PS3="%F{$prompt_fg}%K{$prompt_bg}${PS3}%f%k"
PS4="%F{$prompt_fg}%K{$prompt_bg}${PS4}%f%k"

find_emacs
find_git
find_brew
