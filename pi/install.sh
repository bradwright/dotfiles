# -*- mode: sh -*-
#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

pi install "$SCRIPT_DIR"

# Replace the old subagent extension with the maintained implementation.
# The retired agent files were managed by the old installer, so remove them
# only while migrating from that package; later installs must not delete new
# user-owned agents with the same names.
OLD_SUBAGENTS_PACKAGE="npm:@tintinweb/pi-subagents"
if pi list | grep -Fq "$OLD_SUBAGENTS_PACKAGE"; then
  AGENTS_DIR="$HOME/.pi/agent/agents"
  for agent_name in build-planner build-reviewer implementer merger plan-reviewer writer; do
    rm -f "$AGENTS_DIR/$agent_name.md"
  done
  pi remove "$OLD_SUBAGENTS_PACKAGE"
fi
pi install https://github.com/nicobailon/pi-subagents
