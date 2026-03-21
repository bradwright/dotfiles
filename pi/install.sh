# -*- mode: sh -*-
#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

pi install "$SCRIPT_DIR"

# Companion packages — extensions that provide tools/commands we
# depend on at runtime. Our code degrades gracefully if these are
# missing, but the full experience requires them.
pi install npm:pi-subagents
