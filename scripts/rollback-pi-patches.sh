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

if [ ! -d "$PI_AI_ROOT" ]; then
	echo "pi-ai directory not found: $PI_AI_ROOT" >&2
	exit 1
fi

if [ -f "$PATCH_FILE" ] && patch --dry-run -R -p1 -d "$PI_AI_ROOT" < "$PATCH_FILE" >/dev/null 2>&1; then
	patch -R -p1 -d "$PI_AI_ROOT" < "$PATCH_FILE"
	echo "Rolled back patch via reverse apply: $PATCH_FILE"
	exit 0
fi

if [ ! -d "$BACKUP_DIR" ]; then
	echo "No applied patch found and no backup directory present: $BACKUP_DIR" >&2
	exit 1
fi

restored_any=0
for rel in $TARGET_FILES; do
	src="$BACKUP_DIR/${rel//\//__}.orig"
	dst="$PI_AI_ROOT/$rel"
	if [ -f "$src" ]; then
		cp "$src" "$dst"
		restored_any=1
	fi
done

if [ "$restored_any" -eq 1 ]; then
	echo "Restored patched files from backups in: $BACKUP_DIR"
	exit 0
fi

echo "Nothing to rollback."
