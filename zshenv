# -*- mode: sh -*-

# don't ring the bell for everything ever
setopt nobeep

# Include library functionss
if [ -f $HOME/.functions ]; then
    source $HOME/.functions
fi

typeset -U path

find_emacs
find_git
find_brew
find_ruby zsh
find_subl
fix_path
