# -*- mode: sh -*-
#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

pi install "$SCRIPT_DIR"

# Install user-scope agents that skills depend on (pi packages don't
# handle agents, so we copy them manually).
AGENTS_DIR="$HOME/.pi/agent/agents"
mkdir -p "$AGENTS_DIR"
for agent in "$SCRIPT_DIR"/agents/*.md; do
  [ -f "$agent" ] && cp "$agent" "$AGENTS_DIR/"
done

# Companion packages — extensions that provide tools/commands we
# depend on at runtime. Our code degrades gracefully if these are
# missing, but the full experience requires them.
pi install npm:@tintinweb/pi-subagents
