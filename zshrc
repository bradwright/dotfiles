# -*- mode: sh -*-

# Most of this borrowed from:
# https://github.com/threedaymonk/config/blob/master/zshrc


# initialize autocomplete here, otherwise functions won't be loaded
autoload -Uz zutil
autoload -Uz compinit
autoload -Uz complist
compinit

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

export EDITOR="emacsclient -t"
export VISUAL="$EDITOR"

export SHOW_GIT_PROMPT=true

# Work around tmux's if-shell functionality being crap
if [ "$TMUX" ] && [ $TERM = "xterm-256color" ]; then
    export TERM="screen-256color"
fi

# which platform?
UNAME=`uname`

# Include library functionss
if [ -f $HOME/.functions ]; then
    source $HOME/.functions
fi

# Show stuff in prompt
precmd() {
    # Clear all colours
    clr="%b%f%k"

    # my Tmux config has the host already, so we can hide it from the
    # prompt.
    if [ "$TMUX_PANE" ]; then
        PS1=""
    elif [ "$SSH_CONNECTION" ]; then
        PS1="%F{red}%m "
    else
        PS1="%F{magenta}%m "
    fi

    PS1="${PS1}${clr}%F{green}%~ "
    local ENDPROMPT="> ${clr}"
    if [ "$SSH_CONNECTION" ]; then
        ENDPROMPT="%F{red}${ENDPROMPT}"
    fi

    PS1="${PS1}${ENDPROMPT}"
    PS2="${ENDPROMPT}"

    if ${SHOW_GIT_PROMPT:=true} ; then
        if git branch >& /dev/null; then
            if type __git_ps1 >/dev/null 2>&1; then
                GIT_PS1_SHOWDIRTYSTATE=true
                PS1="${clr}%F{black}%K{yellow} $(__git_ps1 '%s') ${clr} ${PS1}"
            fi
        fi
    fi

}

export PATH
