# this is for OS X, because it doesn't load bashrc on each login, it
# loads bash_profile.

# If not running interactively, don't do anything
[ -z "$PS1" ] && return

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
    if [ $TMUX_PANE ]; then
        PS1=""
    elif [ "$SSH_CONNECTION" ]; then
        PS1="${txtrst}${txtred}@\h${txtrst} "
    else
        PS1="${txtrst}${txtpur}\h${txtrst} "
    fi

    PS1="${PS1}${txtrst}${txtgrn}\w \$${txtrst} "

    if git branch >& /dev/null; then
        PS1="${txtrst}${txtblk}${bakylw} $(git branch --no-color | grep '^*' | cut -d ' ' -f 2-) ${txtrst} ${PS1}"
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

if [ -f ~/.bashrc ]; then
    . ~/.bashrc
fi
