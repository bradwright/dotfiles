# ~/.bashrc
#
# We just want Emacs really

if [ `uname` = 'Darwin' ]; then
    # check all 3 places we might have Emacs set up
    dir="$HOME/Applications"
    emacsen=$(find "$dir" -name Emacs | head -n 1)

    if [ -z "$emacsen" ]; then
        dir="/Applications"
        emacsen=$(find "$dir" -name Emacs | head -n 1)
    fi

    if [ -d /usr/local/Cellar/emacs && -z "$emacsen" ]; then
        dir="/usr/local/Cellar/emacs"
        emacsen=$(find "$dir" -name Emacs | head -n 1)
    fi

    if [ -n "$emacsen" ]; then
        alias emacs="$emacsen"
        emacsclient=$(find "$dir" -name emacsclient | head -n 1)
        alias emacsclient="'$emacsclient'"
        alias vemacs="'$emacsclient' -c -n"
        export EDITOR="'$emacsclient' -t"
        export VISUAL="'$emacsclient' -c"
    fi
fi
