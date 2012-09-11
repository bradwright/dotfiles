# -*- mode: sh -*-

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
