-- Migration: Sync database with schema.sql
-- Date: 2025-01-18 14:00:00
-- Description: Bring database structure in sync with schema.sql after migration inconsistencies

BEGIN;

-- 1. Fix transactions table structure to match schema.sql
-- The schema.sql expects transaction_hash to be VARCHAR(88) and nullable
-- Some migrations may have made it VARCHAR(66) and NOT NULL

-- First, make transaction_hash nullable if it's currently NOT NULL
DO $$
BEGIN
    -- Check if transaction_hash has NOT NULL constraint
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'transactions' 
        AND column_name = 'transaction_hash' 
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE transactions ALTER COLUMN transaction_hash DROP NOT NULL;
    END IF;
END $$;

-- Extend transaction_hash to VARCHAR(88) if it's currently smaller
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'transactions' 
        AND column_name = 'transaction_hash' 
        AND character_maximum_length < 88
    ) THEN
        ALTER TABLE transactions ALTER COLUMN transaction_hash TYPE VARCHAR(88);
    END IF;
END $$;

-- 2. Ensure all required indexes exist from schema.sql
CREATE INDEX IF NOT EXISTS idx_transactions_signature ON transactions(signature);
CREATE INDEX IF NOT EXISTS idx_transactions_slot ON transactions(slot);
CREATE INDEX IF NOT EXISTS idx_transactions_network_family ON transactions(network_family);

-- 3. Fix unique constraints to match schema.sql
-- Remove old unique constraint on transaction_hash if it exists
DROP INDEX IF EXISTS transactions_transaction_hash_key;

-- Add network-aware unique constraints from schema.sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_hash_network ON transactions(transaction_hash, network_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_signature_network ON transactions(signature, network_id);

-- 4. Ensure contract_events has network_id and proper constraints
-- Add network_id to contract_events if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'contract_events' 
        AND column_name = 'network_id'
    ) THEN
        ALTER TABLE contract_events ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
        -- Remove default after setting values
        ALTER TABLE contract_events ALTER COLUMN network_id DROP DEFAULT;
    END IF;
END $$;

-- Fix contract_events transaction_hash length
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'contract_events' 
        AND column_name = 'transaction_hash' 
        AND character_maximum_length < 88
    ) THEN
        ALTER TABLE contract_events ALTER COLUMN transaction_hash TYPE VARCHAR(88);
    END IF;
END $$;

-- Update contract_events unique constraint to include network_id
DROP INDEX IF EXISTS contract_events_unique_tx_log;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_events_unique_tx_log_network 
ON contract_events(transaction_hash, log_index, network_id);

-- 5. Ensure escrow_id_mapping has network_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'escrow_id_mapping' 
        AND column_name = 'network_id'
    ) THEN
        ALTER TABLE escrow_id_mapping ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
        -- Remove default after setting values
        ALTER TABLE escrow_id_mapping ALTER COLUMN network_id DROP DEFAULT;
    END IF;
END $$;

-- Fix escrow_id_mapping unique constraint to include network_id
DROP INDEX IF EXISTS escrow_id_mapping_blockchain_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_id_mapping_blockchain_network 
ON escrow_id_mapping(blockchain_id, network_id);

-- 6. Ensure all tables have proper network_id columns and indexes
-- This is a comprehensive check for all tables that should have network_id

-- Add network_id to any missing tables (defensive programming)
DO $$
DECLARE
    table_name TEXT;
    tables_to_check TEXT[] := ARRAY[
        'disputes', 'dispute_evidence', 'dispute_resolutions', 
        'trade_cancellations', 'contract_auto_cancellations'
    ];
BEGIN
    FOREACH table_name IN ARRAY tables_to_check
    LOOP
        -- Check if table exists and has network_id
        IF EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name = table_name
        ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = table_name 
            AND column_name = 'network_id'
        ) THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id)', table_name);
            EXECUTE format('ALTER TABLE %I ALTER COLUMN network_id DROP DEFAULT', table_name);
            EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_network_id ON %I(network_id)', table_name, table_name);
        END IF;
    END LOOP;
END $$;

-- 7. Ensure all address fields are VARCHAR(44) for Solana support
-- This should have been handled by previous migrations, but let's be sure

DO $$
DECLARE
    table_name TEXT;
    column_name TEXT;
    address_columns RECORD;
BEGIN
    -- Get all address columns that might need updating
    FOR address_columns IN 
        SELECT table_name, column_name 
        FROM information_schema.columns 
        WHERE column_name LIKE '%address%' 
        AND table_schema = 'public'
        AND character_maximum_length < 44
    LOOP
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE VARCHAR(44)', 
                      address_columns.table_name, address_columns.column_name);
    END LOOP;
END $$;

-- 8. Add missing indexes from schema.sql
CREATE INDEX IF NOT EXISTS idx_networks_network_family ON networks(network_family);
CREATE INDEX IF NOT EXISTS idx_networks_program_id ON networks(program_id);
CREATE INDEX IF NOT EXISTS idx_networks_is_active ON networks(is_active);

-- Ensure all network_id indexes exist
CREATE INDEX IF NOT EXISTS idx_offers_network_id ON offers(network_id);
CREATE INDEX IF NOT EXISTS idx_trades_network_id ON trades(network_id);
CREATE INDEX IF NOT EXISTS idx_escrows_network_id ON escrows(network_id);
CREATE INDEX IF NOT EXISTS idx_transactions_network_id ON transactions(network_id);
CREATE INDEX IF NOT EXISTS idx_contract_events_network_id ON contract_events(network_id);
CREATE INDEX IF NOT EXISTS idx_contract_auto_cancellations_network_id ON contract_auto_cancellations(network_id);
CREATE INDEX IF NOT EXISTS idx_disputes_network_id ON disputes(network_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_network_id ON dispute_evidence(network_id);
CREATE INDEX IF NOT EXISTS idx_dispute_resolutions_network_id ON dispute_resolutions(network_id);
CREATE INDEX IF NOT EXISTS idx_trade_cancellations_network_id ON trade_cancellations(network_id);
CREATE INDEX IF NOT EXISTS idx_escrow_id_mapping_network_id ON escrow_id_mapping(network_id);

-- Solana-specific indexes
CREATE INDEX IF NOT EXISTS idx_escrows_network_family ON escrows(network_family);
CREATE INDEX IF NOT EXISTS idx_escrows_program_id ON escrows(program_id);
CREATE INDEX IF NOT EXISTS idx_escrows_escrow_pda ON escrows(escrow_pda);
CREATE INDEX IF NOT EXISTS idx_escrows_escrow_onchain_id ON escrows(escrow_onchain_id);
CREATE INDEX IF NOT EXISTS idx_transactions_network_family ON transactions(network_family);
CREATE INDEX IF NOT EXISTS idx_transactions_signature ON transactions(signature);
CREATE INDEX IF NOT EXISTS idx_transactions_slot ON transactions(slot);

-- Compound indexes for commonly queried combinations
CREATE INDEX IF NOT EXISTS idx_offers_network_type ON offers(network_id, offer_type);
CREATE INDEX IF NOT EXISTS idx_trades_network_status ON trades(network_id, overall_status);
CREATE INDEX IF NOT EXISTS idx_escrows_network_state ON escrows(network_id, state);
CREATE INDEX IF NOT EXISTS idx_transactions_network_status ON transactions(network_id, status);
CREATE INDEX IF NOT EXISTS idx_contract_events_network_name ON contract_events(network_id, event_name);

-- 9. Ensure proper unique constraints from schema.sql
-- Ensure escrow onchain IDs are unique within a network
DROP INDEX IF EXISTS idx_unique_trade_onchain_escrow;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_trade_onchain_escrow_network 
ON escrows (trade_id, onchain_escrow_id, network_id) 
WHERE onchain_escrow_id IS NOT NULL;

COMMIT;
