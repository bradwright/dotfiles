# -*- mode: sh -*-

[ "$TERM" = "dumb" ] && return

# zsh completions - this must be done before compinit
find_completion zsh

# initialize autocomplete here, otherwise functions won't be loaded
autoload -Uz zutil
autoload -Uz compinit
autoload -Uz complist
compinit

unsetopt menu_complete   # do not autoselect the first completion entry
unsetopt flowcontrol
setopt auto_menu         # show completion menu on succesive tab press
setopt complete_in_word
setopt always_to_end

# http://zsh.sourceforge.net/Doc/Release/Completion-System.html (search for "auto-description")
zstyle ':completion:*' auto-description 'specify: %d'

# http://zsh.sourceforge.net/Doc/Release/Completion-System.html#Control-Functions
zstyle ':completion:*' completer _expand _complete _correct _approximate

# Prepend "Completing X" to group headings
zstyle ':completion:*' format 'Completing %d'

# display ALL groups of commands as headings (e.g "Make targets
# ... Make variables" etc)
zstyle ':completion:*' group-name ''

# show completion menu when number of options is at least 2
zstyle ':completion:*' menu select=2
if /usr/bin/which dircolors >/dev/null; then
  eval "$(dircolors -b)"
fi
zstyle ':completion:*:default' list-colors ${(s.:.)LS_COLORS}
zstyle ':completion:*' list-colors ''
zstyle ':completion:*' list-prompt %SAt %p: Hit TAB for more, or the character to insert%s
zstyle ':completion:*' matcher-list '' 'm:{a-z-}={A-Z_}' 'r:|[._-]=* r:|=* l:|=*'
zstyle ':completion:*' select-prompt %SScrolling active: current selection at %p%s

zstyle ':completion:*' verbose true
# Use a cache otherwise rake, apt etc. are unusable
zstyle ':completion::complete:*' use-cache 1

# Autocomplete the SSH command based on ssh_config and known_hosts
h=()
if [[ -r ~/.ssh/config ]]; then
  h=($h ${${${(@M)${(f)"$(cat ~/.ssh/config)"}:#Host *}#Host }:#*[*?]*})
fi
if [[ -r ~/.ssh/known_hosts ]]; then
  h=($h ${${${(f)"$(cat ~/.ssh/known_hosts{,2} || true)"}%%\ *}%%,*}) 2>/dev/null
fi
if [[ $#h -gt 0 ]]; then
  zstyle ':completion:*:ssh:*' hosts $h
  zstyle ':completion:*:slogin:*' hosts $h
fi

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

    PS1="${clr}${PS1}${clr}%F{green}%~ "
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

    # set title of shell
    local title_mode=0
    # xterm can take tab titles using the 1 bit
    case $TERM in
        *xterm*)
            if [ "$SSH_CONNECTION" ]; then
                print -Pn "\033]1;@%m: %~\007"
            else
                print -Pn "\033]1;%~\007"
            fi
            title_mode=2
            ;;
    esac
    # Emacs terminal emulators can't handle this print statement
    # TODO: factor this out to be xterm specific
    [[ $TERM != eterm* ]] && print -Pn "\033]$title_mode;%n@%M: %~\007"

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
