#!/usr/bin/env bash
set -euo pipefail

file=$(jq -r '.tool_input.file_path // .tool_input.path // ""')
tool=$(jq -r '.tool_name // ""')

[ -z "$file" ] && exit 0

# Normalize: strip leading repo path so patterns match relative paths too.
rel="${file#"$PWD/"}"

# Exact-match or glob-like protected paths (regex, anchored).
protected_patterns=(
  '(^|/)\.env($|\.)'
  '(^|/)jwt2?\.txt$'
  '.*\.pem$'
  '.*\.key$'
  '(^|/)package-lock\.json$'
  '(^|/)yarn\.lock$'
  '(^|/)\.npmrc$'
  '(^|/)systemd/.*\.(service|socket|timer)$'
  '(^|/)schema\.sql$'
  '(^|/)\.git/'
  '(^|/)secrets/'
)

for pattern in "${protected_patterns[@]}"; do
  if echo "$rel" | grep -qE "$pattern"; then
    echo "Blocked: '$rel' is a protected file." >&2
    echo "If editing this is intentional, ask the user to make the change or temporarily disable this hook." >&2
    exit 2
  fi
done

# Migrations are append-only: allow creating NEW migration files (Write to a
# path that does not yet exist) but block edits to existing ones.
if echo "$rel" | grep -qE '(^|/)migrations/.*\.sql$'; then
  if [ -e "$file" ]; then
    echo "Blocked: '$rel' is an existing migration and must not be edited in place." >&2
    echo "Create a new migration file instead (migrations are append-only)." >&2
    exit 2
  fi
fi

exit 0
