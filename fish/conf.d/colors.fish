# -*- mode: fish -*-
#
# Solarized-friendly fish colors via ANSI names. Ghostty's palette owns
# the actual hex values, so changing the terminal theme repaints fish
# too. Use `set -g` (not `-U`) so this file stays the source of truth
# instead of values getting frozen in ~/.config/fish/fish_variables.

# Syntax highlighting
set -g fish_color_command       green
set -g fish_color_keyword        brgreen
set -g fish_color_param          brblue
set -g fish_color_option         brblue
set -g fish_color_quote          yellow
set -g fish_color_redirection    brmagenta
set -g fish_color_end            brgreen
set -g fish_color_operator       brcyan
set -g fish_color_escape         cyan
set -g fish_color_error          red
set -g fish_color_comment        brblack --italic
set -g fish_color_autosuggestion brblack

# Selection / search / matching
set -g fish_color_search_match   --background=brblack
set -g fish_color_selection      --background=brblack
set -g fish_color_match          --underline
set -g fish_color_valid_path     --underline

# Completion pager
set -g fish_pager_color_prefix              brcyan --bold --underline
set -g fish_pager_color_progress            brblack
set -g fish_pager_color_description         brblack --italic
set -g fish_pager_color_selected_background --background=brblack
