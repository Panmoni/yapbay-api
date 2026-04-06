#!/usr/bin/env bash
set -euo pipefail

cmd=$(jq -r '.tool_input.command // ""')
[ -z "$cmd" ] && exit 0

log_dir="$(dirname "$0")/.."
log_file="$log_dir/command-log.txt"

printf '%s  %s\n' "$(date -Is)" "$cmd" >> "$log_file"
exit 0
