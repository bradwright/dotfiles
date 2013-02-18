# -*- mode: sh -*-

# don't ring the bell for everything ever
setopt nobeep

# Include library functionss
if [ -f $HOME/.functions ]; then
    source $HOME/.functions
fi

typeset -U path

source_if_exists /opt/boxen/env.sh

# Boxen takes care of find_ruby etc.
if [ -f /opt/boxen/env.sh ]; then
    source /opt/boxen/env.sh
else
    find_ruby
fi

find_emacs
fix_path

set_editor
