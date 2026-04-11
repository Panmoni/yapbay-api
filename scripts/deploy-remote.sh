#!/usr/bin/env bash
#
# deploy-remote.sh — Deploy yapbay-api on tucker.
#
# Runs the full deploy lifecycle: git pull, pre-deploy checks, conditional
# migrations, container build, service restart, and health check.
#
# Invoked automatically by GitHub Actions on push to main, or manually via
# `npm run deploy:remote` on tucker.

set -euo pipefail

# ── Environment for systemctl --user in non-interactive SSH ─────────────────
# Without these, `systemctl --user` fails with "Failed to connect to bus".
# Declare and assign separately so shellcheck doesn't flag SC2155
# (masking return value of id(1) inside the export).
XDG_RUNTIME_DIR="/run/user/$(id -u)"
export XDG_RUNTIME_DIR
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"

# ── Configuration ───────────────────────────────────────────────────────────
REPO_DIR="${REPO_DIR:-$HOME/repos/yapbay-api}"
# /health (not /api/health) is the auth-free liveness endpoint that returns
# 200 with a full JSON health report. /api/health is behind auth and returns
# 401 "No token provided" — using it here would fail every deploy.
HEALTH_URL="${HEALTH_URL:-http://localhost:3011/health}"
# Retry budget: 20 attempts × 3s delay = up to 60s wall time for the container
# to come up. Solana RPC warmup + DB pool init can eat ~15-20s on a cold start.
HEALTH_RETRIES=20
HEALTH_DELAY=3
# Per-request curl budget: connect + read. Without these, a hung container
# (stuck event loop, stalled query) would block on the OS TCP timeout for
# ~2 minutes per attempt.
HEALTH_CONNECT_TIMEOUT=2
HEALTH_MAX_TIME=5
LOG_RETENTION_DAYS=30

cd "$REPO_DIR"

# ── Logging ─────────────────────────────────────────────────────────────────
mkdir -p logs
# Prune old deploy logs (retain last LOG_RETENTION_DAYS days)
find logs -name 'deploy-*.log' -mtime +"$LOG_RETENTION_DAYS" -delete 2>/dev/null || true
LOG_FILE="logs/deploy-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== yapbay-api deploy: $(date -Iseconds) ==="
echo "Repo:     $REPO_DIR"
echo "Log:      $LOG_FILE"

# ── Step 1: Log current commit for manual rollback reference ──────────────
# This is logged (not auto-rolled-back on failure) so an operator can pick
# it out of the deploy log and run `git reset --hard <sha> && npm run
# deploy:remote` by hand. Auto-rollback on a financial system needs more
# thought than a one-liner — prefer loud failures the operator has to ack.
PREV_COMMIT=$(git rev-parse HEAD)
echo "Previous commit: $PREV_COMMIT  (use for manual rollback if needed)"

# ── Step 2: Pull latest code ────────────────────────────────────────────────
echo "--- Pulling latest from origin/main ---"
git fetch origin main
git reset --hard origin/main
CURRENT_COMMIT=$(git rev-parse HEAD)
echo "Current commit:  $CURRENT_COMMIT"

if [ "$PREV_COMMIT" = "$CURRENT_COMMIT" ]; then
    echo "No new commits — redeploying anyway (manual trigger or retry)."
fi

# ── Step 3: Install host-level dependencies for migration scripts ──────────
# The container build has its own dependency install via yarn; this host
# install is only needed to run scripts/migrate.js and deployment-gate.js.
echo "--- Installing host dependencies ---"
npm ci --no-audit --no-fund

# ── Step 4: Pre-deploy gate ─────────────────────────────────────────────────
echo "--- Running deployment gate ---"
node scripts/db/deployment-gate.js

# ── Step 5: Run migrations if pending ───────────────────────────────────────
# Capture --dry-run output in a variable so we can distinguish "no pending
# migrations" (happy path) from an actual crash in migrate.js (e.g., DB
# unreachable, malformed SQL). The old `if ... | grep -q; then` pattern
# treated a crash as "pending migrations" and ran migrate.js for real
# against the same broken state — the real error would still surface, but
# the log line would be confusing. Handle the crash path explicitly.
echo "--- Checking for pending migrations ---"
if ! MIGRATE_DRY_RUN_OUTPUT=$(node scripts/migrate.js --dry-run 2>&1); then
    echo "FATAL: migrate.js --dry-run failed:"
    echo "$MIGRATE_DRY_RUN_OUTPUT"
    exit 1
fi
if grep -q "No pending migrations" <<<"$MIGRATE_DRY_RUN_OUTPUT"; then
    echo "No pending migrations."
else
    echo "Pending migrations detected — running migrations..."
    node scripts/migrate.js
    echo "Migrations complete."
fi

# ── Step 6: Build container image ───────────────────────────────────────────
echo "--- Building container image ---"
podman build -f Containerfile -t localhost/yapbay-api:latest .

# ── Step 7: Restart yapbay-api container ───────────────────────────────────
# Do NOT touch yapbay-pod.service (NOTE: it is yapbay-pod, not
# yapbay-api-pod — since the 2026-04-11 network consolidation, yapbay-api
# shares the `yapbay` pod with yapbay-vite, pricing-server, and redis).
# Restarting the pod would cascade to those three unrelated services for
# no reason. Only the yapbay-api container needs to be recreated to pick
# up the new image.
#
# Use `stop` and `start` as two separate commands, NOT `systemctl restart`.
# Quadlet pod-bound container services regularly fail to come back up via
# `restart` due to a dependency race (the pod BindsTo relationship gets
# into a transient broken state between the stop and start halves). A
# fresh `start` after an explicit `stop` re-evaluates the dependency graph
# from a clean state. This is the same fix we use everywhere else in the
# stack — see the server-config repo's feedback_quadlet_restart_failure
# memory note for the full diagnostic ladder.
echo "--- Stopping yapbay-api container ---"
systemctl --user stop yapbay-api.service
echo "--- Starting yapbay-api container ---"
systemctl --user start yapbay-api.service

# ── Step 8: Health check ────────────────────────────────────────────────────
echo "--- Health check: $HEALTH_URL ---"
for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    if curl -sf \
            --connect-timeout "$HEALTH_CONNECT_TIMEOUT" \
            --max-time "$HEALTH_MAX_TIME" \
            "$HEALTH_URL" > /dev/null 2>&1; then
        echo "Health check passed (attempt $attempt)."
        echo "=== Deploy complete: $CURRENT_COMMIT ==="
        exit 0
    fi
    echo "Health check attempt $attempt/$HEALTH_RETRIES failed — retrying in ${HEALTH_DELAY}s..."
    sleep "$HEALTH_DELAY"
done

echo "FATAL: Health check failed after $HEALTH_RETRIES attempts."
echo "--- Service status ---"
systemctl --user status yapbay-api.service --no-pager || true
echo "--- Recent logs ---"
journalctl --user -u yapbay-api.service -n 50 --no-pager || true
exit 1
