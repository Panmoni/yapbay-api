# Runbook: DB pool exhaustion / connection storms / slow queries

## Signal

- Alert: `yapbay_db_pool_connections{kind="waiting"}` > 0 sustained.
- 503 / 504 spike from the API.
- Request durations regressing at p95/p99.
- `/health/ready` returning 503 with `checks.db = { ok: false }`.

## Diagnose

1. Pool state:
   ```bash
   curl -sf -H "Authorization: Bearer $METRICS_AUTH_TOKEN" \
     "$API_HOST/metrics" | grep yapbay_db_pool_connections
   ```
2. Long-running queries (attacker, runaway cron, bad migration):
   ```sql
   SELECT pid, now() - query_start AS age, state, query
   FROM pg_stat_activity
   WHERE state != 'idle'
   ORDER BY age DESC
   LIMIT 20;
   ```
3. Locks:
   ```sql
   SELECT blocked.pid AS blocked_pid, blocking.pid AS blocking_pid,
          blocked.query AS blocked_query, blocking.query AS blocking_query
   FROM pg_stat_activity blocked
   JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
   WHERE NOT blocked.granted;
   ```
4. Migrations tracker:
   ```bash
   pnpm migrate:status 2>&1 | tail -30
   ```

## Mitigate

- **Long query**: kill it if safe to abort.
  ```sql
  SELECT pg_cancel_backend(<pid>);    -- gentle
  SELECT pg_terminate_backend(<pid>); -- force
  ```
- **Pool starved by idempotency sweep or cron**: check `scheduledTasks` in
  server.ts, consider temporarily disabling non-critical crons via env
  (e.g. `ESCROW_MONITOR_ENABLED=false`) and restart.
- **Listener flood**: if a burst of blockchain events is overwhelming
  writes, throttle the listener via `SOLANA_LISTENER_BATCH_SIZE` env (if
  set) or restart the listener with a smaller batch.
- **Connection limit reached**: `DB_POOL_MAX` may be too low for current
  traffic. Increase transiently via env + restart.

## Recover

- Restart API after mitigating:
  ```bash
  ssh $API_HOST "systemctl --user restart yapbay-api.service"
  ```
- Watch `/health/ready` return 200 and pool gauge return to baseline.

## Post-incident

- Capture the `pg_stat_activity` snapshot taken during diagnosis — helps
  trace root cause.
- If a specific query was slow, add an index or rewrite; benchmark before
  merging to main.
- Consider raising `DB_POOL_MAX` permanently if sustained load grew.
