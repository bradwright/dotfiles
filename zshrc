# -*- mode: sh -*-

[ "$TERM" = "dumb" ] && return

# zsh completions - this must be done before compinit
find_completion zsh

# initialize autocomplete here, otherwise functions won't be loaded
autoload -Uz zutil
autoload -Uz compinit && compinit
autoload -Uz complist
autoload -Uz bashcompinit && bashcompinit

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
zstyle ':completion:*' use-cache on
zstyle ':completion:*' cache-path ${HOME}/.zsh_cache

# Autocomplete the SSH command based on ssh_config and known_hosts
h=()
if [[ -r ~/.ssh/config ]]; then
  h=($h ${${${(@M)${(f)"$(cat ~/.ssh/config)"}:#Host *}#Host }:#*[*?]*})
fi
if [[ -r ~/.ssh/known_hosts ]]; then
  h=($h ${${${(f)"$(cat ~/.ssh/known_hosts{,2} || true)"}%%\ *}%%,*}) 2>/dev/null
fi
if [[ $#h -gt 0 ]]; then
  zstyle ':completion:*:(ssh|scp|sftp|slogin):*' hosts $h
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
HISTSIZE=100000
SAVEHIST=100000
HISTFILE=~/.zsh_history

# Work around tmux's if-shell functionality being crap
if [ "$TMUX" ] && [ $TERM = "xterm-256color" ]; then
    export TERM="screen-256color"
fi

# Include library functionss
if [ -f $HOME/.functions ]; then
    source $HOME/.functions
fi

# Use starship prompt (https://starship.rs)
if command -v starship > /dev/null; then
    eval "$(starship init zsh)"
fi

# Local overrides
source_if_exists $HOME/.local_zshrc
# My own aliases
source_if_exists $HOME/.aliases

# ZSH plugins
if command -v brew > /dev/null; then
    ANTIGEN_PATH="$(brew --prefix)/share/antigen/antigen.zsh"
    [ -s "$ANTIGEN_PATH" ] && source "$ANTIGEN_PATH"
fi

if command -v antigen > /dev/null; then
    # Lazy load NVM to avoid startup hit
    export NVM_LAZY_LOAD=true

    antigen bundle brew
    antigen bundle lukechilds/zsh-nvm
    antigen apply
fi

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

prepend_path ~/.local/bin
