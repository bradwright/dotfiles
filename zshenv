# -*- mode: sh -*-

# don't ring the bell for everything ever
setopt nobeep

# Prefix commands with whitespace to avoid saving them in shell history
setopt HIST_IGNORE_SPACE

typeset -U path

# Build PATH using zsh arrays (deduplicated by `typeset -U path`).
[[ -d "$HOME/bin" ]] && path=("$HOME/bin" $path)

# Ensure Homebrew is discoverable before calling brew.
[[ -d /opt/homebrew/bin ]] && path=(/opt/homebrew/bin $path)
[[ -d /opt/homebrew/sbin ]] && path=(/opt/homebrew/sbin $path)

if (( $+commands[brew] )); then
    brew_prefix="$(brew --prefix)"
    [[ -d "$brew_prefix/bin" ]] && path=("$brew_prefix/bin" $path)
    [[ -d "$brew_prefix/sbin" ]] && path=("$brew_prefix/sbin" $path)
fi

[[ -d "$HOME/.local/bin" ]] && path=("$HOME/.local/bin" $path)

export EDITOR="nvim"
export VISUAL="nvim"
export GIT_EDITOR="nvim +star"

export GOPATH="$HOME/go"
[[ -d "$GOPATH/bin" ]] && path+=("$GOPATH/bin")

# Make sure that gpg-agent can still authenticate even when redirecting stdout.
export GPG_TTY="$(tty)"

if [[ -d "$HOME/.config/doom" ]]; then
    [[ -d "$HOME/.config/emacs/bin" ]] && path=("$HOME/.config/emacs/bin" $path)
    [[ -d "/Applications/Emacs.app/Contents/MacOS" ]] && path=("/Applications/Emacs.app/Contents/MacOS" $path)
fi

[[ -r "$HOME/.local_zshenv" ]] && source "$HOME/.local_zshenv"
