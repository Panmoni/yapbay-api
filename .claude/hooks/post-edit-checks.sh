#!/usr/bin/env bash
# PostToolUse hook for Edit|Write on TS files:
#   1. eslint --fix on the touched file
#   2. tsc --noEmit project-wide typecheck
# Output is tailed so it doesn't flood context. Always exits 0 so Claude sees
# the diagnostics as feedback rather than a hard block.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // ""')

# Only run for TypeScript source files inside the project.
case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# Skip if file no longer exists (e.g. deletion).
[ -f "$file" ] || exit 0

echo "--- eslint --fix $file ---"
npx --no-install eslint --fix "$file" 2>&1 | tail -20 || true

echo "--- tsc --noEmit ---"
npx --no-install tsc --noEmit 2>&1 | tail -20 || true

exit 0
