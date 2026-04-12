#!/usr/bin/env bash
# Install repo-managed git hooks into .git/hooks.
# Safe to run from any environment (CI, Docker build, fresh clone):
# silently exits 0 if .git/hooks is missing (e.g. shallow/tarball checkouts,
# container builds where .git is not copied, pnpm store hydration, etc.).

set -euo pipefail

HOOKS_SRC_DIR="$(cd "$(dirname "$0")" && pwd)/git-hooks"
HOOKS_DEST_DIR=".git/hooks"

if [ ! -d "$HOOKS_DEST_DIR" ]; then
  # Not a full git checkout — nothing to do.
  exit 0
fi

if [ ! -d "$HOOKS_SRC_DIR" ]; then
  echo "install-hooks: source dir $HOOKS_SRC_DIR missing, skipping." >&2
  exit 0
fi

for hook in "$HOOKS_SRC_DIR"/*; do
  [ -f "$hook" ] || continue
  name=$(basename "$hook")
  install -m 0755 "$hook" "$HOOKS_DEST_DIR/$name"
done

echo "install-hooks: installed hooks from $HOOKS_SRC_DIR -> $HOOKS_DEST_DIR"
