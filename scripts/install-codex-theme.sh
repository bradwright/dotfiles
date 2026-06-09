# -*- mode: sh -*-
#!/usr/bin/env sh
set -eu

usage() {
  printf '%s\n' \
    'usage: install-codex-theme.sh <target-config.toml> <theme.json>' \
    '       install-codex-theme.sh --clean <target-config.toml>' >&2
  exit 2
}

mode=install
theme=

case "${1:-}" in
  --clean)
    [ "$#" -eq 2 ] || usage
    mode=clean
    target=$2
    ;;
  *)
    [ "$#" -eq 2 ] || usage
    target=$1
    theme=$2
    ;;
esac

if [ "$mode" = clean ] && [ ! -f "$target" ]; then
  exit 0
fi

if [ "$mode" = install ]; then
  [ -f "$theme" ] || {
    printf 'Codex theme file not found: %s\n' "$theme" >&2
    exit 1
  }

  command -v jq >/dev/null 2>&1 || {
    printf '%s\n' 'jq is required to install the Codex theme.' >&2
    exit 1
  }

  jq -e '
    .variant == "dark"
    and (.codeThemeId | type == "string")
    and (.theme.surface | type == "string")
    and (.theme.ink | type == "string")
    and (.theme.accent | type == "string")
    and (.theme.contrast | type == "number")
    and (.theme.opaqueWindows | type == "boolean")
    and (.theme.fonts | type == "object")
    and (.theme.semanticColors | type == "object")
  ' "$theme" >/dev/null

  mkdir -p "$(dirname "$target")"
fi

tmp="${target}.tmp"
theme_snippet=
trap 'rm -f "$tmp" ${theme_snippet:+"$theme_snippet"}' EXIT HUP INT TERM

code_theme_line=
if [ "$mode" = install ]; then
  code_theme_line="appearanceDarkCodeThemeId = $(jq -r '.codeThemeId | @json' "$theme")"
  theme_snippet=$(mktemp "${TMPDIR:-/tmp}/codex-theme.XXXXXX")

  {
    printf '%s\n' '[desktop.appearanceDarkChromeTheme]'
    jq -r '
      .theme
      | "accent = \(.accent | @json)\ncontrast = \(.contrast)\nink = \(.ink | @json)\nopaqueWindows = \(.opaqueWindows)\nsurface = \(.surface | @json)"
    ' "$theme"

    printf '\n%s\n' '[desktop.appearanceDarkChromeTheme.fonts]'
    jq -r '
      .theme.fonts
      | to_entries[]
      | select(.value != null)
      | "\(.key) = \(.value | @json)"
    ' "$theme"

    printf '\n%s\n' '[desktop.appearanceDarkChromeTheme.semanticColors]'
    jq -r '
      .theme.semanticColors
      | to_entries[]
      | "\(.key) = \(.value | @json)"
    ' "$theme"
  } > "$theme_snippet"
fi

input=/dev/null
if [ -f "$target" ]; then
  input=$target
fi

awk -v mode="$mode" -v code_theme_line="$code_theme_line" '
function is_theme_section(header) {
  return header == "[desktop.appearanceDarkChromeTheme]" ||
    header == "[desktop.appearanceDarkChromeTheme.fonts]" ||
    header == "[desktop.appearanceDarkChromeTheme.semanticColors]"
}

function maybe_insert_code_theme() {
  if (mode == "install" && in_desktop && !inserted) {
    print code_theme_line
    inserted = 1
  }
}

BEGIN {
  in_desktop = 0
  inserted = 0
  saw_desktop = 0
  drop = 0
}

$0 ~ /^[[:space:]]*\[[^]]+\][[:space:]]*(#.*)?$/ {
  maybe_insert_code_theme()

  header = $0
  sub(/^[[:space:]]*/, "", header)
  sub(/[[:space:]]*(#.*)?$/, "", header)

  if (is_theme_section(header)) {
    drop = 1
    in_desktop = 0
    next
  }

  drop = 0
  in_desktop = header == "[desktop]"
  if (in_desktop) {
    saw_desktop = 1
  }
}

drop {
  next
}

in_desktop && $0 ~ /^[[:space:]]*appearanceDarkCodeThemeId[[:space:]]*=/ {
  next
}

{
  print
}

END {
  maybe_insert_code_theme()
  if (mode == "install" && !saw_desktop) {
    if (NR > 0) {
      print ""
    }
    print "[desktop]"
    print code_theme_line
  }
}
' "$input" > "$tmp"

if [ "$mode" = install ]; then
  if [ -s "$tmp" ]; then
    printf '\n' >> "$tmp"
  fi
  cat "$theme_snippet" >> "$tmp"
fi

mv "$tmp" "$target"
trap - EXIT HUP INT TERM
rm -f ${theme_snippet:+"$theme_snippet"}
