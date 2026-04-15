# -*- mode: fish -*-

# ---------------------------------------------------------------------------
# PATH and shared environment
# ---------------------------------------------------------------------------

# Initialize Homebrew environment without requiring brew to already be on PATH.
if test -x /opt/homebrew/bin/brew
    /opt/homebrew/bin/brew shellenv fish | source
else if test -x /usr/local/bin/brew
    /usr/local/bin/brew shellenv fish | source
end

# Personal scripts
fish_add_path --prepend ~/bin ~/.local/bin

# Doom Emacs
if test -d ~/.config/doom
    fish_add_path --prepend ~/.config/emacs/bin /Applications/Emacs.app/Contents/MacOS
end

# Shared editor settings — keep these aligned with zshenv.
set -gx EDITOR et
set -gx VISUAL et
set -gx GIT_EDITOR et
set -gx BAT_THEME ansi

# Bail out early for non-interactive shells (scripts, scp, etc.)
status is-interactive; or return

# Suppress fish's startup greeting for a cleaner prompt
set -g fish_greeting

# Keep gpg-agent attached to the current TTY for interactive use.
set -gx GPG_TTY (tty)

# ---------------------------------------------------------------------------
# Abbreviations (expand inline so you see the real command)
# ---------------------------------------------------------------------------

# Modern CLI replacements
abbr -a ls  eza
abbr -a ll  'eza -lg'
abbr -a la  'eza -lag'
abbr -a tree 'eza --tree'
abbr -a cat 'bat --plain'
abbr -a du  dust
abbr -a top btm

abbr -a picodex 'pi "/codex" --provider openai-codex --model gpt-5.3-codex'

# ---------------------------------------------------------------------------
# Tool integrations
# ---------------------------------------------------------------------------

# Starship prompt — use fish-specific config (blue ❯ instead of purple)
# so you can tell which shell you're in at a glance. Enable transient
# prompt so previous commands collapse to a minimal "❯ ".
if command -q starship
    set -gx STARSHIP_CONFIG ~/.config/fish/starship.toml
    function starship_transient_prompt_func
        # Green breadcrumb for previous commands — visually distinct
        # from the active purple ❯ so you can spot where you are.
        set_color green
        printf '❯ '
        set_color normal
    end
    starship init fish | source
    enable_transience
end

# fzf keybindings and completion
if command -q fzf
    fzf --fish | source
    # Solarized Dark colors via ANSI names (let the terminal theme own hex)
    set -gx FZF_DEFAULT_OPTS " \
        --color=fg:-1,bg:-1,fg+:bright-cyan,bg+:black,hl:blue,hl+:blue \
        --color=info:bright-green,prompt:yellow,pointer:cyan,marker:green \
        --color=spinner:cyan,header:bright-green,border:bright-green \
        --border=rounded --layout=reverse --height=~40%"
    set -gx FZF_DEFAULT_COMMAND 'fd --type f --hidden --follow --exclude .git'
    set -gx FZF_CTRL_T_COMMAND $FZF_DEFAULT_COMMAND
    set -gx FZF_ALT_C_COMMAND 'fd --type d --hidden --follow --exclude .git'
    set -gx FZF_CTRL_T_OPTS "--preview 'bat --color=always --style=numbers --line-range=:500 {}'"
    set -gx FZF_ALT_C_OPTS "--preview 'eza --tree --level=2 {}'"
end

# nvm.fish — lazy-loads nvm so there's no startup cost
set -gx nvm_default_version lts

# direnv (project-local environment)
if command -q direnv
    direnv hook fish | source
end

# zoxide (smarter cd)
if command -q zoxide
    zoxide init fish | source
end

# Emacs vterm shell integration (directory tracking, prompt marking, etc.)
if test "$INSIDE_EMACS" = vterm; and set -q EMACS_VTERM_PATH; and test -f "$EMACS_VTERM_PATH/etc/emacs-vterm.fish"
    source "$EMACS_VTERM_PATH/etc/emacs-vterm.fish"
end

# ---------------------------------------------------------------------------
# Local overrides (not in repo)
# ---------------------------------------------------------------------------

if test -f ~/.local_fish
    source ~/.local_fish
end
