#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Battery Info
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 🔋
# @raycast.packageName System

# Documentation:
# @raycast.description Show battery percentage and time remaining

pmset_output=$(pmset -g batt)
percent=$(echo "$pmset_output" | grep -o '[0-9]\+%' | head -1)
time_remaining=$(echo "$pmset_output" | grep -o '[0-9]\+:[0-9]\+ remaining' | head -1)

if [ -n "$time_remaining" ]; then
  msg="${percent} | ${time_remaining}"
else
  msg="${percent}"
fi

echo "🔋 ${msg}"
