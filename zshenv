# -*- mode: sh -*-

# don't ring the bell for everything ever
setopt nobeep

# Include library functionss
if [ -f $HOME/.functions ]; then
    source $HOME/.functions
fi

typeset -U path

find_homebrew
find_ruby zsh
fix_path

set_editor
