#!/usr/bin/env bash
# -*- mode: sh -*-
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PATCH_FILE="${PATCH_FILE:-$REPO_ROOT/patches/pi-ai-anthropic-ratelimit.patch}"

NPM_GLOBAL_ROOT="$(npm root -g)"
PI_AI_ROOT_DEFAULT="$NPM_GLOBAL_ROOT/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai"
PI_AI_ROOT="${PI_AI_ROOT:-$PI_AI_ROOT_DEFAULT}"

BACKUP_DIR="$PI_AI_ROOT/.dotfiles-patch-backups"

TARGET_FILES="dist/providers/anthropic.js dist/types.d.ts"

if [ ! -f "$PATCH_FILE" ]; then
	echo "Patch file not found: $PATCH_FILE" >&2
	exit 1
fi

if [ ! -d "$PI_AI_ROOT" ]; then
	echo "pi-ai directory not found: $PI_AI_ROOT" >&2
	exit 1
fi

# Already applied if reverse dry-run succeeds
# Already applied if reverse dry-run succeeds AND forward dry-run fails
if patch --dry-run -f -R -p1 -d "$PI_AI_ROOT" < "$PATCH_FILE" >/dev/null 2>&1 \
   && ! patch --dry-run -f -p1 -d "$PI_AI_ROOT" < "$PATCH_FILE" >/dev/null 2>&1; then
	echo "Patch already applied at: $PI_AI_ROOT"
	exit 0
fi

# Apply only if forward dry-run succeeds
if ! patch --dry-run -f -p1 -d "$PI_AI_ROOT" < "$PATCH_FILE" >/dev/null 2>&1; then
	echo "Patch cannot be applied cleanly at: $PI_AI_ROOT" >&2
	echo "pi-ai version may have changed. Inspect and refresh patches/pi-ai-anthropic-ratelimit.patch" >&2
	exit 1
fi

mkdir -p "$BACKUP_DIR"
for rel in $TARGET_FILES; do
	src="$PI_AI_ROOT/$rel"
	dst="$BACKUP_DIR/${rel//\//__}.orig"
	if [ -f "$src" ] && [ ! -f "$dst" ]; then
		cp "$src" "$dst"
	fi
done

patch -p1 -d "$PI_AI_ROOT" < "$PATCH_FILE"

echo "Applied patch: $PATCH_FILE"
echo "Target: $PI_AI_ROOT"
echo "Backups: $BACKUP_DIR"
