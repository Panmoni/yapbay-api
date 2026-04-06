# Database Migrations

This directory contains SQL migration files that modify the database schema.

## Naming Convention

Use **sequentially numbered** migration filenames in the format:

```
NNNN-YYYY-MM-DD-short-description.sql
```

### Examples
```
0021-2025-04-29-add-missing-columns.sql
0032-2026-04-06-remap-migration-versions.sql
0033-2026-04-06-create-migrations-tracking-table.sql
```

### Rules
- **Sequential number** (4-digit, zero-padded) determines execution order
- **Date** is the date the migration is created (ISO 8601: `YYYY-MM-DD`)
- **Description** uses lowercase words separated by hyphens
- To get the next number: find the highest existing number in `migrations/` and add 1
- Files are applied in **lexicographic sort order**; the numeric prefix guarantees correct ordering
- Never reuse or reassign a sequence number

## Migration Guidelines

1. **Use `IF NOT EXISTS` / `IF EXISTS`** for all DDL to make migrations idempotent
2. **Use parameterized values** — never interpolate user data into SQL strings
3. **Test migrations** on a development database before applying to production
4. **Do NOT self-register** in the `migrations` table — the runner handles tracking

### Optional Down Migration (Rollback)

To make a migration reversible, add a `-- DOWN` marker followed by the rollback SQL:

```sql
-- Migration: Add nickname field to accounts table

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS nickname VARCHAR(255);

-- DOWN
ALTER TABLE accounts DROP COLUMN IF EXISTS nickname;
```

The migration runner only executes SQL **above** the `-- DOWN` marker during normal runs.
To roll back:

```bash
npm run migrate:rollback -- 0034-2026-04-07-add-nickname.sql
```

## Running Migrations

```bash
# Apply pending migrations
npm run migrate

# Check status
npm run migrate:status

# Dry run (show what would happen)
npm run migrate:dry-run

# Verify migration records and schema state (read-only)
npm run migrate:verify

# Create backup only
npm run migrate:backup

# Roll back a specific migration
npm run migrate:rollback -- <filename.sql>

# Health check (verifies schema matches migration expectations)
npm run migrate:health

# Full database health check (compares schema.sql to live DB)
npm run db:health
npm run db:health:verbose

# Pre-deployment gate (all checks)
npm run deploy:check
```

## Migrations Table

The `migrations` table tracks applied migrations:

```sql
CREATE TABLE migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) UNIQUE NOT NULL,
  checksum VARCHAR(64),           -- SHA-256 hash
  execution_time_ms INTEGER,
  environment VARCHAR(20),
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Concurrency Protection

The migration runner acquires a PostgreSQL advisory lock before running. If another
migration process is already running against the same database, the runner will fail
immediately with a clear message rather than risk concurrent schema modifications.

## Structured Logging (JSONL)

Every migration run emits structured JSON log entries to `logs/migration.jsonl` (git-ignored).
Use this log for forensic investigation if migration records or schema changes disappear unexpectedly.
