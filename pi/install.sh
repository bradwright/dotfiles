# -*- mode: sh -*-
#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

pi install "$SCRIPT_DIR"
