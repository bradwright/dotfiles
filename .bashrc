# ~/.bashrc
#

# If not running interactively, don't do anything
[ -z "$PS1" ] && return

# don't put duplicate lines in the history. See bash(1) for more options
# ... or force ignoredups and ignorespace
HISTCONTROL=ignoredups:ignorespace

# append to the history file, don't overwrite it
shopt -s histappend

# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)
HISTSIZE=1000
HISTFILESIZE=2000

# check the window size after each command and, if necessary,
# update the values of LINES and COLUMNS.
shopt -s checkwinsize

export EDITOR="emacsclient -nw"
export VISUAL="$EDITOR"

export SHOW_GIT_PROMPT=true

# which platform?
UNAME=`uname`

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
    if [ $UNAME = Darwin ]; then
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

    # This is Homebrew specific - it works around the readlink command
    # failing across upgrades by pointing directly at the symlink
    # Homebrew uses.
    if [ -e /usr/local/Library/LinkedKegs/git/bin/git ]; then
        prepend_path "/usr/local/Library/LinkedKegs/git/bin"
    elif [ -e /usr/local/bin/git ]; then
        git=$(readlink /usr/local/bin/git)
        if [ -n "$git" ]; then
            gitdir=$(dirname $git)
            prepend_path "/usr/local/bin/$gitdir"
        fi
    fi
}

find_brew() {
    # explicitly put homebrew bin in PATH, as other shells might not
    # find it
    if [ $UNAME = Darwin ]; then
        brewpath=$(command -v brew)
        brewdir=$(dirname $brewpath)
        append_path $brewdir
    fi
}

find_completion() {
    # enable programmable completion features (you don't need to enable
    # this, if it's already enabled in /etc/bash.bashrc and /etc/profile
    # sources /etc/bash.bashrc).
    if [ $UNAME = Linux ] && ! shopt -oq posix; then
        if [ -f /etc/bash_completion ]; then
            source /etc/bash_completion
        elif [ -d /etc/bash_completion.d ]; then
            echo "Run 'sudo apt-get install bash-completion' to install completion"
        fi
    elif [ $UNAME = "Darwin" ]; then
        if [ -f `brew --prefix`/etc/bash_completion ]; then
            . `brew --prefix`/etc/bash_completion
        fi
    fi
}

find_ruby() {
    # Ruby libraries
    # check for rbenv first
    local FOUND_RBENV=false
    if [ -d $HOME/.rbenv/bin ]; then
        prepend_path $HOME/.rbenv/bin
        $FOUND_RBENV=true
    elif [ -d /usr/local/Library/LinkedKegs/rbenv/bin ]; then
        prepend_path /usr/local/Library/LinkedKegs/rbenv/bin
        $FOUND_RBENV=true
    fi
    if [ $FOUND_RBENV ]; then
        if command -v rbenv > /dev/null; then
            eval "$(rbenv init -)"
        fi
    elif [ -d $HOME/.rvm/bin ]; then
        append_path $HOME/.rvm/bin
        [[ -s "$HOME/.rvm/scripts/rvm" ]] && source "$HOME/.rvm/scripts/rvm"
    fi
    # shortcut for making local bundles

    # From http://tomafro.net/2012/06/tip-bundler-with-binstubs
    # I don't want to specifically overwrite bundle, as that won't fly
    # in production etc.
    alias bl="bundle install --path .bundle/gems"
    alias bb="bl --binstubs .bundle/bin"

    prepend_path "./.bundle/bin"

    alias bi="bundle install"
    alias be="bundle exec"
}

find_emacs
find_git
find_brew
find_completion
find_ruby

# local changes
if [ -f ~/.local_bashrc ]; then
    . ~/.local_bashrc
fi

# include aliases
if [ -f ~/.bash_aliases ]; then
    . ~/.bash_aliases
fi



# Colours
txtblk='\[\033[0;30m\]' # Black - Regular
txtred='\[\033[0;31m\]' # Red
txtgrn='\[\033[0;32m\]' # Green
txtylw='\[\033[0;33m\]' # Yellow
txtblu='\[\033[0;34m\]' # Blue
txtpur='\[\033[0;35m\]' # Purple
txtcyn='\[\033[0;36m\]' # Cyan
txtwht='\[\033[0;37m\]' # White
bldblk='\[\033[1;30m\]' # Black - Bold
bldred='\[\033[1;31m\]' # Red
bldgrn='\[\033[1;32m\]' # Green
bldylw='\[\033[1;33m\]' # Yellow
bldblu='\[\033[1;34m\]' # Blue
bldpur='\[\033[1;35m\]' # Purple
bldcyn='\[\033[1;36m\]' # Cyan
bldwht='\[\033[1;37m\]' # White
unkblk='\[\033[4;30m\]' # Black - Underline
undred='\[\033[4;31m\]' # Red
undgrn='\[\033[4;32m\]' # Green
undylw='\[\033[4;33m\]' # Yellow
undblu='\[\033[4;34m\]' # Blue
undpur='\[\033[4;35m\]' # Purple
undcyn='\[\033[4;36m\]' # Cyan
undwht='\[\033[4;37m\]' # White
bakblk='\[\033[40m\]'   # Black - Background
bakred='\[\033[41m\]'   # Red
bakgrn='\[\033[42m\]'   # Green
bakylw='\[\033[43m\]'   # Yellow
bakblu='\[\033[44m\]'   # Blue
bakpur='\[\033[45m\]'   # Purple
bakcyn='\[\033[46m\]'   # Cyan
bakwht='\[\033[47m\]'   # White
txtrst='\[\033[0m\]'    # Text Reset

# Show stuff in prompt
rbenv_prompt() {
    local rbenv_version
    if rbenv version-name >& /dev/null; then
        rbenv_version=$(rbenv version-name)
    fi
    if [ $rbenv_version != "system" ]; then
        echo $rbenv_version
    fi
}

precmd() {
    # my Tmux config has the host already, so we can hide it from the
    # prompt.
    if [ "$TMUX_PANE" ]; then
        PS1=""
    elif [ "$SSH_CONNECTION" ]; then
        PS1="${txtrst}${txtred}@\h${txtrst} "
    else
        PS1="${txtrst}${txtpur}\h${txtrst} "
    fi

    PS1="${PS1}${txtrst}${txtgrn}\w "
    local ENDPROMPT="> ${txtrst}"
    if [ "$SSH_CONNECTION" ]; then
        ENDPROMPT="${txtred}${ENDPROMPT}"
    fi

    PS1="${PS1}${ENDPROMPT}"
    PS2="${ENDPROMPT}"

    if ${SHOW_GIT_PROMPT:=true} ; then
        if git branch >& /dev/null; then
            if type __git_ps1 >/dev/null 2>&1; then
                GIT_PS1_SHOWDIRTYSTATE=true
                PS1="${txtrst}${txtblk}${bakylw} $(__git_ps1 '%s') ${txtrst} ${PS1}"
            fi
        fi
    fi

    if [ $RUBY_VERSION ]; then
        PS1="${txtrst}${txtwht}${bakred} ${RUBY_VERSION} ${txtrst} ${PS1}"
    fi

    local rbenv_version
    #rbenv_version=$(rbenv_prompt)

    if [ ! -z $rbenv_version ]; then
        PS1="${txtrst}${txtwht}${bakred} ${rbenv_version} ${txtrst} ${PS1}"
    fi

    case $TERM in
        xterm*|rxvt*)
            PS1="\[\033]0;\h:\w\007\]${PS1}"
            ;;
    esac
}

PROMPT_COMMAND=precmd

export PATH
