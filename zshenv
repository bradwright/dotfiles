# -*- mode: sh -*-

# don't ring the bell for everything ever
setopt nobeep

# Prefix commands with whitespace to avoid saving them in shell historya
setopt HIST_IGNORE_SPACE

# Include library functionss
if [ -f $HOME/.functions ]; then
    source $HOME/.functions
fi

typeset -U path

find_ruby
fix_path

set_editor

set_go_path

source_if_exists $HOME/.local_zshenv

# Make sure that gpg-agent can still authenticate even when redirecting stdout
export GPG_TTY=$(tty)

# Lazy load NVM to avoid startup hit
export NVM_LAZY_LOAD=true
