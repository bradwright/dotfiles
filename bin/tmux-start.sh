#!/bin/sh

# Mostly lifted from:
# http://www.huyng.com/posts/productivity-boost-with-tmux-iterm2-workspaces

export PATH=$PATH:usr/local/bin

default_name=local

# abort if we're already inside a TMUX session
[ "$TMUX" == "" ] || exit 0

# startup a "default" session if none currently exists
tmux has-session -t $default_name || tmux new-session -s $default_name -d

# present menu for user to choose which workspace to open
PS3="Please choose your session: "
options=($(tmux list-sessions -F "#S") "NEW SESSION" "SHELL")
echo "Available sessions"
echo "------------------"
echo " "
select opt in "${options[@]}"
do
    case $opt in
        "NEW SESSION")
            read -p "Enter new session name: " SESSION_NAME
            tmux new -s "$SESSION_NAME"
            break
            ;;
        "SHELL")
            $SHELL --login
            break;;
        *)
            tmux attach-session -t $opt
            break
            ;;
    esac
done
