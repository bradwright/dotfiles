# -*- mode: sh -*-

# don't ring the bell for everything ever
setopt nobeep

# Include library functionss
if [ -f $HOME/.functions ]; then
    source $HOME/.functions
fi

typeset -U path

find_ruby
find_emacs
fix_path

set_editor
