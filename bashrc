# -*- mode: sh -*-

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

export GIT_EDITOR="emacsclient -t"
export VISUAL="emacsclient -t"

export SHOW_GIT_PROMPT=true

# which platform?
UNAME=`uname`

# Add directory to PATH if it exists and is not already there.
# TODO: abstract "in path" out to a function

# This has come from: http://superuser.com/a/462852/76009
normalise_path() {
    PATH=${PATH//":$1"/} # deletes any instances in the middle or at the end
    PATH=${PATH//"$1:"/} # deletes any instances at the start
    export PATH
}

prepend_path () {
    normalise_path $1
    export PATH="$1:$PATH" # prepend to beginning
}

append_path () {
    normalise_path $1
    export PATH="$PATH:$1" # append to end
}

find_emacs() {
    # finds my Emacs install

    # Homebrew specific finding of emacs - this is via the LinkedKegs
    # method of installing things (which points at the latest
    # installed version).

    # We assume Linux has its shit together and doesn't need extra
    # mangling.
    if [ $UNAME = Darwin ] && [ -e /usr/local/Library/LinkedKegs/emacs/bin/emacs ]; then
        prepend_path /usr/local/Library/LinkedKegs/emacs/bin
    fi
}

find_subl() {
    # Finds Sublime Text 2 and adds the `subl` helper to the PATH
    if [ -e "${HOME}/Applications/Sublime Text 2.app/Contents/SharedSupport/bin/subl" ]; then
        prepend_path ~/Applications/Sublime\ Text\ 2.app/Contents/SharedSupport/bin
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
    if [ $UNAME = Darwin ] && [ -e /usr/local/Library/LinkedKegs/git/bin/git ]; then
        prepend_path /usr/local/Library/LinkedKegs/git/bin
    elif [ -e /usr/local/bin/git ]; then
        local git=$(readlink /usr/local/bin/git)
        if [ -n "$git" ]; then
            prepend_path /usr/local/bin/$(dirname $git)
        fi
    fi
}

find_brew() {
    # explicitly put homebrew bin in PATH, as other shells might not
    # find it
    if [ $UNAME = Darwin ] && command -v brew > /dev/null; then
        append_path `brew --prefix`/bin
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
    elif [ $UNAME = Darwin ]; then
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
        FOUND_RBENV=true
    elif [ -d /usr/local/Library/LinkedKegs/rbenv/bin ]; then
        prepend_path /usr/local/Library/LinkedKegs/rbenv/bin
        FOUND_RBENV=true
    fi
    if $FOUND_RBENV ; then
        if command -v rbenv > /dev/null; then
            eval "$(rbenv init -)"
        fi
    fi
    # shortcut for making local bundles

    # From http://tomafro.net/2012/06/tip-bundler-with-binstubs
    # I don't want to specifically overwrite bundle, as that won't fly
    # in production etc.
    alias bl="bundle install --path .bundle/gems"
    alias bb="bl --binstubs .bundle/bin"

    # Because this PATH is magic, prepend_path won't add it, as it
    # doesn't exist at runtime.
    prepend_path ./.bundle/bin

    alias bi="bundle install"
    alias be="bundle exec"
}

fix_path() {
    # Add any local scripts I run into PATH
    if [ -d $HOME/bin ]; then
        prepend_path $HOME/bin
    fi
}

find_emacs
find_git
find_brew
find_completion
find_ruby
find_subl
fix_path

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

    case $TERM in
        xterm*|rxvt*)
            PS1="\[\033]0;\h:\w\007\]${PS1}"
            ;;
    esac
}

PROMPT_COMMAND="precmd;$PROMPT_COMMAND"

export PATH

# Work around tmux asynchronous `if-shell` behaviour
if [ "$TMUX" ] && [ $TERM = "xterm-256color" ]; then
    export TERM="screen-256color"
fi
