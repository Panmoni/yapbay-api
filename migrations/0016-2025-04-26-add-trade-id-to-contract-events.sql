-- Migration: add trade_id to contract_events table
BEGIN;

-- remove outdated trigger on contract_events to avoid update trigger error
DROP TRIGGER IF EXISTS update_contract_events_updated_at ON contract_events;

-- 1. Add trade_id column (nullable)
ALTER TABLE contract_events ADD COLUMN trade_id BIGINT;

-- 2. Backfill existing rows with tradeId from args JSONB when present
UPDATE contract_events
SET trade_id = (args->>'tradeId')::BIGINT
WHERE args ? 'tradeId';

-- 3. Index on trade_id for fast lookup
CREATE INDEX IF NOT EXISTS idx_contract_events_trade_id ON contract_events(trade_id);

COMMIT;
