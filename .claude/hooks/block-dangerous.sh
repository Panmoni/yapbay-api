#!/usr/bin/env bash
set -euo pipefail

cmd=$(jq -r '.tool_input.command // ""')

# Patterns are matched case-insensitively as extended regex.
dangerous_patterns=(
  'rm[[:space:]]+-[a-z]*r[a-z]*f'
  'git[[:space:]]+reset[[:space:]]+--hard'
  'git[[:space:]]+push[[:space:]]+.*--force'
  'git[[:space:]]+checkout[[:space:]]+--[[:space:]]*\.'
  'git[[:space:]]+clean[[:space:]]+-[a-z]*f'
  'git[[:space:]]+branch[[:space:]]+-D'
  'DROP[[:space:]]+TABLE'
  'DROP[[:space:]]+DATABASE'
  'TRUNCATE[[:space:]]+.*(escrow|trade|account|transaction)'
  'DELETE[[:space:]]+FROM[[:space:]]+(escrows?|trades?|accounts?|transactions?)([[:space:]]*;|[[:space:]]*$)'
  'curl[[:space:]]+.*\|[[:space:]]*(sh|bash)'
  'wget[[:space:]]+.*\|[[:space:]]*(sh|bash)'
  'podman[[:space:]]+pod[[:space:]]+rm'
  'podman[[:space:]]+(system[[:space:]]+)?prune'
  'systemctl[[:space:]]+.*(stop|disable|mask)[[:space:]]+yapbay'
  'dd[[:space:]]+.*of=/dev/'
  'mkfs\.'
  '>[[:space:]]*/dev/sd[a-z]'
  'chmod[[:space:]]+-R[[:space:]]+777'
)

for pattern in "${dangerous_patterns[@]}"; do
  if echo "$cmd" | grep -qiE "$pattern"; then
    echo "Blocked: command matches dangerous pattern '$pattern'." >&2
    echo "Command: $cmd" >&2
    echo "If this is truly necessary, ask the user to run it manually or disable the hook for this step." >&2
    exit 2
  fi
done

exit 0
