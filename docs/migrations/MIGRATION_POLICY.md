# Migration Policy

## Core Rule

**Migrations MUST be run manually before code deployment.**

## Four-Step Protocol

1. **Run migrations** (manual) — `npm run migrate`
2. **Verify schema** — `npm run migrate:health` and `npm run db:health`
3. **Deploy code** — `npm run deploy`
4. **Monitor logs** — Check application logs for schema-related errors

## Rationale

- Silent failures risk incomplete schema
- No immediate feedback on DDL errors if auto-run at startup
- Application crashes if code expects missing columns
- Difficulty rolling back on failure

## Pre-Deployment Checklist

Before deploying code that depends on schema changes:

1. Run `npm run migrate:status` to see pending migrations
2. Run `npm run migrate` to apply them
3. Run `npm run migrate:health` to verify
4. Run `npm run deploy:check` for full pre-deployment validation
5. Proceed with code deployment

## Failure Recovery

### Migration fails during execution
- Schema is incomplete — safety mechanisms (ON_ERROR_STOP) halt execution
- Fix the issue in the migration SQL
- Re-run `npm run migrate`

### Migration marked applied but schema missing
- Run the DDL manually via psql
- Verify with `npm run migrate:health`
- Do NOT re-add the tracking record

### Code deployed before migrations
- Run migrations immediately: `npm run migrate`
- If urgent, apply DDL manually via psql
- Verify with `npm run db:health`

## Migration File Conventions

- Format: `NNNN-YYYY-MM-DD-descriptive-name.sql`
- Must be idempotent (`IF NOT EXISTS` / `IF EXISTS`)
- Never edit applied migrations — create a new one
- Optional `-- DOWN` section for rollback SQL
- schema.sql must stay in sync with migrations

## Concurrency Protection

The migration runner acquires both a local PID-file lock and a PostgreSQL
advisory lock before running. If another migration process is already running,
the runner will fail immediately with a clear message.

## Structured Logging

Every migration run emits structured JSON log entries to `logs/migration.jsonl`.
Key events: `migration_start`, `pre_run_state`, `migration_applied`,
`record_confirmed`, `canary_failure`, `schema_drift_detected`, `post_run_state`.
