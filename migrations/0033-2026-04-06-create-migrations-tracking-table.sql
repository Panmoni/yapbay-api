-- Migration: Create new migrations tracking table and migrate data from schema_migrations
-- This replaces the old schema_migrations table with a more capable migrations table
-- that tracks checksums, execution times, and environments.

-- Create the new migrations table
CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    checksum VARCHAR(64),
    execution_time_ms INTEGER,
    environment VARCHAR(20) DEFAULT 'production',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_migrations_filename ON migrations(filename);
CREATE INDEX IF NOT EXISTS idx_migrations_applied_at ON migrations(applied_at);
CREATE INDEX IF NOT EXISTS idx_migrations_environment ON migrations(environment);

COMMENT ON TABLE migrations IS 'Tracks which database migrations have been applied';
COMMENT ON COLUMN migrations.filename IS 'Name of the migration file (e.g., 0021-2025-04-29-add-missing-columns.sql)';
COMMENT ON COLUMN migrations.applied_at IS 'When this migration was applied';
COMMENT ON COLUMN migrations.checksum IS 'SHA-256 hash of the migration file for integrity verification';
COMMENT ON COLUMN migrations.execution_time_ms IS 'How long the migration took to execute in milliseconds';
COMMENT ON COLUMN migrations.environment IS 'Which environment this migration was applied to';

-- Migrate data from old schema_migrations table if it exists
DO $$
DECLARE
    old_version TEXT;
    new_filename TEXT;
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'schema_migrations'
    ) THEN
        -- Map old version numbers to new filenames
        -- This handles both the old timestamp versions and the new sequential versions
        FOR old_version IN SELECT version FROM schema_migrations ORDER BY version LOOP
            -- Map sequential versions (from migration 0032) to filenames
            CASE old_version
                WHEN '0000' THEN new_filename := '0000-2025-01-01-add-solana-networks.sql';
                WHEN '0001' THEN new_filename := '0001-2025-01-01-add-solana-escrow-fields.sql';
                WHEN '0002' THEN new_filename := '0002-2025-01-01-add-solana-transaction-fields.sql';
                WHEN '0003' THEN new_filename := '0003-2025-01-01-drop-divvi-referrals-table.sql';
                WHEN '0004' THEN new_filename := '0004-2025-01-18-add-updated-at-to-transactions.sql';
                WHEN '0005' THEN new_filename := '0005-2025-01-18-sync-database-with-schema.sql';
                WHEN '0006' THEN new_filename := '0006-2025-01-19-fix-deadline-trigger-for-releases.sql';
                WHEN '0007' THEN new_filename := '0007-2025-01-31-add-multi-network-support.sql';
                WHEN '0008' THEN new_filename := '0008-2025-04-22-create-transactions-table.sql';
                WHEN '0009' THEN new_filename := '0009-2025-04-22-remove-escrow-address-constraint.sql';
                WHEN '0010' THEN new_filename := '0010-2025-04-22-remove-escrows-address-constraint.sql';
                WHEN '0011' THEN new_filename := '0011-2025-04-22-add-onchain-escrow-ids-to-trades.sql';
                WHEN '0012' THEN new_filename := '0012-2025-04-25-add-contract-events.sql';
                WHEN '0013' THEN new_filename := '0013-2025-04-25-create-trade-cancellations-table.sql';
                WHEN '0014' THEN new_filename := '0014-2025-04-25-enforce-deadline-trigger.sql';
                WHEN '0015' THEN new_filename := '0015-2025-04-25-add-role-to-accounts.sql';
                WHEN '0016' THEN new_filename := '0016-2025-04-26-add-trade-id-to-contract-events.sql';
                WHEN '0017' THEN new_filename := '0017-2025-04-26-add-transaction-id-to-contract-events.sql';
                WHEN '0018' THEN new_filename := '0018-2025-04-28-add-completed-at-to-escrows.sql';
                WHEN '0019' THEN new_filename := '0019-2025-04-28-create-escrow-id-mapping.sql';
                WHEN '0020' THEN new_filename := '0020-2025-04-29-add-trade-onchain-escrow-unique-constraint.sql';
                WHEN '0021' THEN new_filename := '0021-2025-04-29-add-missing-columns.sql';
                WHEN '0022' THEN new_filename := '0022-2025-04-29-create-schema-migrations-table.sql';
                WHEN '0023' THEN new_filename := '0023-2025-04-29-remove-leg1-completed-at.sql';
                WHEN '0024' THEN new_filename := '0024-2025-04-30-add-event-transaction-type-and-escrow-balance.sql';
                WHEN '0025' THEN new_filename := '0025-2025-04-30-add-version-to-escrows.sql';
                WHEN '0026' THEN new_filename := '0026-2025-05-29-add-contract-auto-cancellations.sql';
                WHEN '0027' THEN new_filename := '0027-2025-05-30-create-divvi-referrals-table.sql';
                WHEN '0028' THEN new_filename := '0028-2025-09-12-extend-wallet-address-for-solana.sql';
                WHEN '0029' THEN new_filename := '0029-2025-09-12-extend-escrow-addresses-for-solana.sql';
                WHEN '0030' THEN new_filename := '0030-2025-09-12-extend-remaining-addresses-for-solana.sql';
                WHEN '0031' THEN new_filename := '0031-2025-09-12-fix-all-remaining-varchar42-fields.sql';
                WHEN '0032' THEN new_filename := '0032-2026-04-06-remap-migration-versions.sql';
                ELSE
                    -- Skip unknown versions
                    CONTINUE;
            END CASE;

            INSERT INTO migrations (filename, environment, applied_at)
            VALUES (new_filename, 'production', NOW())
            ON CONFLICT (filename) DO NOTHING;
        END LOOP;

        RAISE NOTICE 'Migrated records from schema_migrations to migrations table';
    END IF;
END $$;

-- Also register this migration itself
INSERT INTO migrations (filename, checksum, environment)
VALUES ('0033-2026-04-06-create-migrations-tracking-table.sql', 'initial_migration', 'production')
ON CONFLICT (filename) DO NOTHING;
