-- Scope idempotency uniqueness to (key, user_sub) instead of key alone.
--
-- Migration 0035 created `key TEXT PRIMARY KEY`, which allowed cross-tenant
-- cache hits: user B replaying user A's Idempotency-Key would fetch A's
-- cached response. Financial data leak across tenants.
--
-- This migration drops the bare primary key, adds a surrogate id, and creates
-- two partial unique indexes so NULL user_sub (anonymous) and identified
-- users each get their own key namespace — NULL != NULL in partial-index
-- uniqueness.

ALTER TABLE idempotency_records DROP CONSTRAINT IF EXISTS idempotency_records_pkey;

ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS id BIGSERIAL;
ALTER TABLE idempotency_records ADD PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_idempotency_records_user_key
  ON idempotency_records (key, user_sub)
  WHERE user_sub IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_idempotency_records_anon_key
  ON idempotency_records (key)
  WHERE user_sub IS NULL;

-- DOWN
DROP INDEX IF EXISTS uniq_idempotency_records_anon_key;
DROP INDEX IF EXISTS uniq_idempotency_records_user_key;
ALTER TABLE idempotency_records DROP CONSTRAINT IF EXISTS idempotency_records_pkey;
ALTER TABLE idempotency_records DROP COLUMN IF EXISTS id;
ALTER TABLE idempotency_records ADD PRIMARY KEY (key);
