# -*- mode: fish -*-

# Bail out early for non-interactive shells (scripts, scp, etc.)
status is-interactive; or return

# ---------------------------------------------------------------------------
# PATH
# ---------------------------------------------------------------------------

# Homebrew (Apple Silicon first, then Intel fallback)
fish_add_path --prepend /opt/homebrew/bin /opt/homebrew/sbin
if command -q brew
    fish_add_path --prepend (brew --prefix)/bin (brew --prefix)/sbin
end

# Personal scripts
fish_add_path --prepend ~/bin ~/.local/bin

# rbenv
if test -d ~/.rbenv
    fish_add_path --prepend ~/.rbenv/bin ~/.rbenv/shims
end

# Go
set -gx GOPATH ~/go
fish_add_path --append $GOPATH/bin

# Doom Emacs
if test -d ~/.config/doom
    fish_add_path --prepend ~/.config/emacs/bin /Applications/Emacs.app/Contents/MacOS
end

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

set -gx EDITOR et
set -gx VISUAL ec
set -gx GIT_EDITOR 'vim +star'
set -gx GPG_TTY (tty)

# ---------------------------------------------------------------------------
# Abbreviations (expand inline so you see the real command)
# ---------------------------------------------------------------------------

# Ruby / Bundler
abbr -a bl 'bundle install --path .bundle/gems'
abbr -a bb 'bundle install --path .bundle/gems --binstubs .bundle/bin'
abbr -a bi 'bundle install'
abbr -a be 'bundle exec'

# Modern CLI replacements
abbr -a ls  eza
abbr -a ll  'eza -lg'
abbr -a la  'eza -lag'
abbr -a tree 'eza --tree'
abbr -a cat 'bat --plain'
abbr -a du  dust
abbr -a top btm

# ---------------------------------------------------------------------------
# Tool integrations
# ---------------------------------------------------------------------------

# Starship prompt
if command -q starship
    starship init fish | source
end

# fzf keybindings and completion
if command -q fzf
    fzf --fish | source
    set -gx FZF_DEFAULT_COMMAND 'fd --type f --hidden --follow --exclude .git'
    set -gx FZF_CTRL_T_COMMAND $FZF_DEFAULT_COMMAND
    set -gx FZF_ALT_C_COMMAND 'fd --type d --hidden --follow --exclude .git'
    set -gx FZF_CTRL_T_OPTS "--preview 'bat --color=always --style=numbers --line-range=:500 {}'"
    set -gx FZF_ALT_C_OPTS "--preview 'eza --tree --level=2 {}'"
end

# nvm.fish — lazy-loads nvm so there's no startup cost
set -gx nvm_default_version lts

# zoxide (smarter cd)
if command -q zoxide
    zoxide init fish | source
end

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

function ai --description 'Quick ephemeral pi session'
    pi --no-session --no-skills --no-extensions --no-prompt-templates $argv
end

function aic --description 'Continue last pi session'
    pi -c $argv
end

# ---------------------------------------------------------------------------
# Local overrides (not in repo)
# ---------------------------------------------------------------------------

if test -f ~/.local_fish
    source ~/.local_fish
end
