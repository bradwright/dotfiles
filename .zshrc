autoload colors zsh/terminfo
if [[ "$terminfo[colors]" -ge 8 ]]; then
    colors
fi

for color in RED GREEN YELLOW BLUE MAGENTA CYAN WHITE; do
    eval PR_$color='%{$terminfo[bold]$fg[${(L)color}]%}'
    eval PR_LIGHT_$color='%{$fg[${(L)color}]%}'
    (( count = $count + 1 ))
done

PR_NO_COLOUR="%{$terminfo[sgr0]%}"

set_my_prompt() {
    PROMPT="$PR_LIGHT_YELLOW%n$PR_LIGHT_WHITE $PR_LIGHT_GREEN%~ $PR_LIGHT_WHITE%# "
}

set_my_prompt

PATH=/opt/local/bin:/usr/local/mysql/bin:/usr/local/git/bin:/usr/local/bin:$PATH
MANPATH=/opt/local/share/man:/usr/local/git/man:$MANPATH