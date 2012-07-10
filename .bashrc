# ~/.bashrc
#
# We just want Emacs really

txtblk='\e[0;30m' # Black - Regular
txtred='\e[0;31m' # Red
txtgrn='\e[0;32m' # Green
txtylw='\e[0;33m' # Yellow
txtblu='\e[0;34m' # Blue
txtpur='\e[0;35m' # Purple
txtcyn='\e[0;36m' # Cyan
txtwht='\e[0;37m' # White
bldblk='\e[1;30m' # Black - Bold
bldred='\e[1;31m' # Red
bldgrn='\e[1;32m' # Green
bldylw='\e[1;33m' # Yellow
bldblu='\e[1;34m' # Blue
bldpur='\e[1;35m' # Purple
bldcyn='\e[1;36m' # Cyan
bldwht='\e[1;37m' # White
unkblk='\e[4;30m' # Black - Underline
undred='\e[4;31m' # Red
undgrn='\e[4;32m' # Green
undylw='\e[4;33m' # Yellow
undblu='\e[4;34m' # Blue
undpur='\e[4;35m' # Purple
undcyn='\e[4;36m' # Cyan
undwht='\e[4;37m' # White
bakblk='\e[40m'   # Black - Background
bakred='\e[41m'   # Red
bakgrn='\e[42m'   # Green
bakylw='\e[43m'   # Yellow
bakblu='\e[44m'   # Blue
bakpur='\e[45m'   # Purple
bakcyn='\e[46m'   # Cyan
bakwht='\e[47m'   # White
txtrst='\e[0m'    # Text Reset

export EDITOR="emacsclient -nw"
export VISUAL="$EDITOR"
export TERM='xterm-256color'

# Add directory to PATH if it exists and is not already there.
# TODO: abstract "in path" out to a function
prepend_path() {
    to_add=$1
    if [ -d $to_add ]; then
        export PATH=$to_add:$PATH
    fi
}

append_path() {
    to_add=$1
    if [ -d $to_add ]; then
        export PATH=$PATH:$to_add
    fi
}

find_emacs() {
    # finds my Emacs install
    if [ `uname` = "Darwin" ]; then
        if [ -d /usr/local/Cellar/emacs ]; then
            dir="/usr/local/Cellar/emacs"
            emacsen=$(find "$dir" -name Emacs -type f | head -n 1)
        fi

        if [ -n "$emacsen" ]; then
            emacsbin=$(find "$dir" -name emacs -type f | head -n 1)

            if [ ! -e "$emacsbin" ]; then
                alias emacs="$emacsen"
            fi

            emacsclient=$(find "$dir" -name emacsclient -type f | head -n 1)
            emacsdir=$(dirname $emacsclient)
            prepend_path $emacsdir
        fi
    fi
}

find_git() {
    # it's recommended *not* to put /usr/local/bin before /usr/bin
    # because there might be system dependencies - however if I don't
    # do something, XCode's Git ends up before my custom one in the
    # path.
    if [ -e /usr/local/bin/git ]; then
        git=$(readlink /usr/local/bin/git)
        gitdir=$(dirname $git)
        prepend_path "/usr/local/bin/$gitdir"
    fi
}

find_brew() {
    # explicitly put homebrew bin in PATH, as other shells might not
    # find it
    if [ `uname` = "Darwin" ]; then
        brewpath=$(command -v brew)
        brewdir=$(dirname $brewpath)
        append_path $brewdir
        if [ -f `brew --prefix`/etc/bash_completion ]; then
            . `brew --prefix`/etc/bash_completion
        fi
    fi
}

# Show stuff in prompt
precmd() {

    # my Tmux config has the host already, so we can hide it from the
    # prompt.
    if [ $TMUX_PANE ]; then
        PS1=""
    elif [ $SSH_CONNECTION ]; then
        PS1="${txtrst}${txtred}\h${txtrst} "
    else
        PS1="${txtrst}${txtpur}\h${txtrst} "
    fi

    PS1="${PS1}${txtrst}${txtgrn}\w \$${txtrst} "

    if git branch >& /dev/null; then
        PS1="${txtrst}${bakylw}${bldblk} $(git branch --no-color | grep '^*' | cut -d ' ' -f 2-) ${txtrst} ${PS1}"
    fi

    if [ $RUBY_VERSION ]; then
        PS1="${txtrst}${txtwht}${bakred} ${RUBY_VERSION} ${txtrst} ${PS1}"
    fi
}

precmd

PROMPT_COMMAND=precmd

PS2="%F{$prompt_fg}%K{$prompt_bg}${PS2}%f%k"
PS3="%F{$prompt_fg}%K{$prompt_bg}${PS3}%f%k"
PS4="%F{$prompt_fg}%K{$prompt_bg}${PS4}%f%k"

find_emacs
find_git
find_brew
export PATH
