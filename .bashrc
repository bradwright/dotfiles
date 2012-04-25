# ~/.bashrc
#
# We just want Emacs really

if [ `uname` = 'Darwin' ]; then
    emacsen=`find ~/Applications/ -name Emacs | head -n 1`
    brew=`which brew`
    if [ -n "$emacsen" ]; then
        alias emacs="$emacsen"
        emacsclient=`find ~/Applications -name emacsclient | head -n 1`
        alias emacsclient="'$emacsclient'"
        alias vemacs="'$emacsclient' -c -n"
        export EDITOR="'$emacsclient' -t"
        export VISUAL="'$emacsclient' -c"
    elif [ -n "$brew" ]; then

    fi
fi
