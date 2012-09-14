# -*- mode: sh -*-

# Most of this borrowed from:
# https://github.com/threedaymonk/config/blob/master/zshrc

zstyle ':completion:*' auto-description 'specify: %d'
zstyle ':completion:*' completer _expand _complete _correct _approximate
zstyle ':completion:*' format 'Completing %d'
zstyle ':completion:*' group-name ''
zstyle ':completion:*' menu select=2
if /usr/bin/which dircolors >/dev/null; then
  eval "$(dircolors -b)"
fi
zstyle ':completion:*:default' list-colors ${(s.:.)LS_COLORS}
zstyle ':completion:*' list-colors ''
zstyle ':completion:*' list-prompt %SAt %p: Hit TAB for more, or the character to insert%s
zstyle ':completion:*' matcher-list '' 'm:{a-z-}={A-Z_}' 'r:|[._-]=* r:|=* l:|=*'
zstyle ':completion:*' select-prompt %SScrolling active: current selection at %p%s
zstyle ':completion:*' use-compctl false
zstyle ':completion:*' verbose true

# initialize autocomplete here, otherwise functions won't be loaded
autoload -Uz zutil
autoload -Uz compinit
autoload -Uz complist
compinit

# so backwards kill works over directories and not the whole path
autoload -U select-word-style
select-word-style bash

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
    if [ "$SSH_CONNECTION" ]; then
        ENDPROMPT="%F{red}>>${clr} "
    else
        ENDPROMPT="%F{yellow}>>${clr} "
    fi

    PS1="${PS1}${ENDPROMPT}"
    PS2="${ENDPROMPT}"

    if ${SHOW_GIT_PROMPT:=true} ; then
        if git branch >& /dev/null; then
            PS1="${clr}%F{black}%K{yellow} $(git_prompt_info) ${clr} ${PS1}"
        fi
    fi

}

# Install Git prompt/completion
source_if_exists /usr/local/etc/bash_completion.d/git-prompt.bash
source_if_exists /usr/local/etc/bash_completion.d/git-completion.bash
source_if_exists /usr/local/etc/bash_completion.d/git-prompt.sh
source_if_exists /usr/local/etc/bash_completion.d/git-completion.sh
source_if_exists /etc/bash_completion.d/git

# Local overrides
source_if_exists $HOME/.local_zshrc
# Aliases
source_if_exists $HOME/.bash_aliases
# My own aliases
source_if_exists $HOME/.aliases
