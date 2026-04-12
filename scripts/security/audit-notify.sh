#!/usr/bin/env bash
# audit-notify.sh — run dependency audit and open a GitHub issue on failure.
#
# Designed for scheduled runs (systemd timer, cron). Idempotent: if an open
# [security] issue with the same title already exists, comments on it
# instead of creating a duplicate.
#
# Requires:
#   - gh CLI authenticated (gh auth status)
#   - yarn on PATH (from corepack)
#
# Exits 0 whether or not vulnerabilities are found — the signal is the
# issue/comment, not the exit code. The systemd unit can still see stderr
# via journald if the script itself crashes.

set -uo pipefail

REPO="Panmoni/yapbay-api"
TITLE="[security] Weekly dependency audit found vulnerabilities"

cd "$(dirname "$0")/../.." || exit 1

# IMPORTANT: `cmd || true` suppresses the real exit code. We need to
# capture the actual audit exit code, so we use a pattern that sets a
# variable only on failure. `set -e` is off (we use `set -uo pipefail`),
# so the `||` short-circuit works as intended here.
yarn_exit=0
yarn_out=$(yarn audit --level moderate 2>&1) || yarn_exit=$?

# Only run npm audit if a package-lock.json exists. Since we consolidated
# on yarn, package-lock.json is normally absent — running npm audit without
# it fails with ENOLOCK which would produce false-positive issues.
npm_exit=0
npm_out="(skipped — no package-lock.json; yarn is the canonical lockfile)"
if [ -f package-lock.json ]; then
  npm_out=$(npm audit --audit-level=moderate 2>&1) || npm_exit=$?
fi

if [ "$yarn_exit" -eq 0 ] && [ "$npm_exit" -eq 0 ]; then
  echo "audit-notify: clean, no action needed."
  exit 0
fi

echo "audit-notify: vulnerabilities detected (yarn=$yarn_exit, npm=$npm_exit)."

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
host=$(hostname)

# Neutralize any triple-backticks in audit output so they don't escape
# the markdown code fence in the GitHub issue body. Replace ``` with '``''`.
yarn_safe=$(printf '%s' "$yarn_out" | sed 's/```/`` `/g')
npm_safe=$(printf '%s' "$npm_out" | sed 's/```/`` `/g')

body=$(cat <<EOF
Scheduled audit on \`${host}\` at \`${ts}\` found moderate+ severity vulnerabilities.

### yarn audit
\`\`\`
${yarn_safe}
\`\`\`

### npm audit
\`\`\`
${npm_safe}
\`\`\`

Fix by upgrading the parent package or pinning a patched transitive via
\`resolutions\` (yarn) and \`overrides\` (npm) in \`package.json\`.

Close when \`yarn audit --level moderate\` and \`npm audit --audit-level=moderate\` are clean.
EOF
)

# Ensure the `security` label exists — idempotent, silent if already there.
gh label create security --repo "$REPO" --color d73a4a \
  --description "Dependency or code security issue" 2>/dev/null || true

# Check for an existing open issue with the same title. We filter by title
# rather than label so deduplication works even if the label is missing.
existing=$(gh issue list --repo "$REPO" --state open --search "\"${TITLE}\" in:title" \
  --json number,title | jq -r ".[] | select(.title == \"${TITLE}\") | .number" | head -1)

if [ -n "${existing:-}" ]; then
  echo "audit-notify: commenting on existing issue #${existing}"
  gh issue comment "$existing" --repo "$REPO" --body "New failure on ${host} at ${ts}."
else
  echo "audit-notify: opening new issue"
  gh issue create --repo "$REPO" --title "$TITLE" --label security --body "$body"
fi
