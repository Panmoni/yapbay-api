#!/usr/bin/env bash
# Apply schema + migrations to the ephemeral test Postgres started by
# docker-compose.test.yml. Idempotent — safe to rerun.
#
# Usage:
#   docker compose -f docker-compose.test.yml up -d
#   scripts/test-db-bootstrap.sh
#   pnpm test

set -euo pipefail

TEST_DB_URL="${TEST_POSTGRES_URL:-postgres://yapbay:yapbay@127.0.0.1:55432/yapbay_test}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found in PATH. Install postgresql-client first." >&2
  exit 1
fi

# Wait for the DB to accept connections (the compose healthcheck is faster,
# but when someone runs this against an arbitrary URL we poll directly).
for i in $(seq 1 30); do
  if PGPASSWORD=yapbay psql "$TEST_DB_URL" -c 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "DB at $TEST_DB_URL not reachable after 30s." >&2
    exit 1
  fi
done

echo "bootstrap: applying schema.sql"
PGPASSWORD=yapbay psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f schema.sql

# The migration runner handles idempotency + drift detection. Point it at the
# test DB via POSTGRES_URL so it doesn't touch anything else.
echo "bootstrap: running migrations via scripts/migrate.js"
YAPBAY_TEST_DB_OVERRIDE=1 POSTGRES_URL="$TEST_DB_URL" node scripts/migrate.js

echo "bootstrap: ready at $TEST_DB_URL"
