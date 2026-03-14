# -*- mode: sh -*-

typeset -U path

# Build PATH using zsh arrays (deduplicated by `typeset -U path`).
[[ -d "$HOME/bin" ]] && path=("$HOME/bin" $path)

# Homebrew paths (Apple Silicon + Intel).
[[ -d /opt/homebrew/bin ]] && path=(/opt/homebrew/bin $path)
[[ -d /opt/homebrew/sbin ]] && path=(/opt/homebrew/sbin $path)
[[ -d /usr/local/bin ]] && path=(/usr/local/bin $path)
[[ -d /usr/local/sbin ]] && path=(/usr/local/sbin $path)

[[ -d "$HOME/.local/bin" ]] && path=("$HOME/.local/bin" $path)

export EDITOR="nvim"
export VISUAL="nvim"
export GIT_EDITOR="nvim +star"

export GOPATH="$HOME/go"
[[ -d "$GOPATH/bin" ]] && path+=("$GOPATH/bin")

if [[ -d "$HOME/.config/doom" ]]; then
    [[ -d "$HOME/.config/emacs/bin" ]] && path=("$HOME/.config/emacs/bin" $path)
    [[ -d "/Applications/Emacs.app/Contents/MacOS" ]] && path=("/Applications/Emacs.app/Contents/MacOS" $path)
fi

[[ -r "$HOME/.local_zshenv" ]] && source "$HOME/.local_zshenv"
