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

export EDITOR="emacsclient"
export VISUAL="$EDITOR"

# Default prompt colours
prompt_fg=black
prompt_bg=green

# Show stuff in prompt
precmd() {
    exit_status=$?

    if [ $HISTFILE ]; then
        fg=$prompt_fg
        bg=$prompt_bg
    else
        fg=$prompt_bg
        bg=$prompt_fg
    fi

    PS1="%F{$fg}%K{$bg} %(3~|[…]/|)%2~ >%b%f%k "

    if git branch >& /dev/null; then
        PS1="%F{black}%K{yellow} $(git branch --no-color | grep '^*' | cut -d ' ' -f 2-) ${PS1}"
    fi

    if [ $RUBY_VERSION ]; then
        PS1="%F{black}%K{white} ${RUBY_VERSION} ${PS1}"
    fi

    if test $exit_status -ne 0; then
        PS1="%F{white}%K{red} ${exit_status} ${PS1}"
    fi
}

PS2="%F{$prompt_fg}%K{$prompt_bg}${PS2}%f%k"
PS3="%F{$prompt_fg}%K{$prompt_bg}${PS3}%f%k"
PS4="%F{$prompt_fg}%K{$prompt_bg}${PS4}%f%k"
