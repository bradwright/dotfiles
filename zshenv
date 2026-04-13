# -*- mode: sh -*-

typeset -U path

# Initialize Homebrew environment without requiring brew to already be on PATH.
if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv zsh)"
elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv zsh)"
fi

# Personal scripts.
[[ -d "$HOME/bin" ]] && path=("$HOME/bin" $path)
[[ -d "$HOME/.local/bin" ]] && path=("$HOME/.local/bin" $path)

export EDITOR="et"
export VISUAL="et"
export GIT_EDITOR="et"
export BAT_THEME="ansi"

if [[ -d "$HOME/.config/doom" ]]; then
    [[ -d "$HOME/.config/emacs/bin" ]] && path=("$HOME/.config/emacs/bin" $path)
    [[ -d "/Applications/Emacs.app/Contents/MacOS" ]] && path=("/Applications/Emacs.app/Contents/MacOS" $path)
fi

[[ -r "$HOME/.local_zshenv" ]] && source "$HOME/.local_zshenv"
