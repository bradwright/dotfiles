# -*- mode: sh -*-

[ "$TERM" = "dumb" ] && return

# Interactive shell behaviour.
setopt nobeep
setopt HIST_IGNORE_SPACE

# Make sure that gpg-agent can still authenticate even when redirecting stdout.
export GPG_TTY="$(tty)"

# zsh completions - this must be done before compinit
# Homebrew shellenv already wires site-functions; add zsh-completions explicitly.
brew_prefix="${HOMEBREW_PREFIX:-}"
if [[ -z "$brew_prefix" ]] && (( $+commands[brew] )); then
    brew_prefix="$(brew --prefix)"
fi
if [[ -n "$brew_prefix" ]]; then
    [[ -d "$brew_prefix/share/zsh-completions" ]] && fpath=("$brew_prefix/share/zsh-completions" $fpath)
fi

# initialize autocomplete
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

# Use starship prompt (https://starship.rs)
if command -v starship > /dev/null; then
    eval "$(starship init zsh)"
fi

# Local overrides
[[ -r "$HOME/.local_zshrc" ]] && source "$HOME/.local_zshrc"
# My own aliases
[[ -r "$HOME/.aliases" ]] && source "$HOME/.aliases"

# Emacs vterm shell integration (directory tracking, prompt marking, etc.)
[[ -r "$HOME/.config/emacs/.local/straight/repos/emacs-libvterm/etc/emacs-vterm-zsh.sh" ]] && source "$HOME/.config/emacs/.local/straight/repos/emacs-libvterm/etc/emacs-vterm-zsh.sh"

# ZSH plugins
if [[ -n "$brew_prefix" ]]; then
    ANTIGEN_PATH="$brew_prefix/share/antigen/antigen.zsh"
    [ -s "$ANTIGEN_PATH" ] && source "$ANTIGEN_PATH"
fi

if command -v antigen > /dev/null; then
    # Lazy load NVM to avoid startup hit
    export NVM_LAZY_LOAD=true

    antigen bundle brew
    antigen bundle lukechilds/zsh-nvm
    antigen apply
fi

# fzf shell integration (keybindings and completion)
if command -v fzf > /dev/null; then
    eval "$(fzf --zsh)"
    # Use fd for fzf file search (respects .gitignore)
    export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'
    export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
    # Use fd for directory search
    export FZF_ALT_C_COMMAND='fd --type d --hidden --follow --exclude .git'
    # Preview files with bat, directories with eza
    export FZF_CTRL_T_OPTS="--preview 'bat --color=always --style=numbers --line-range=:500 {}'"
    export FZF_ALT_C_OPTS="--preview 'eza --tree --level=2 {}'"
fi

# zoxide (smarter cd)
if command -v zoxide > /dev/null; then
    eval "$(zoxide init zsh)"
fi

