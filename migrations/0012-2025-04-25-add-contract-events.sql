-- Migration: add contract_events table to capture blockchain logs
BEGIN;

-- 1. Create table
CREATE TABLE IF NOT EXISTS contract_events (
  id SERIAL PRIMARY KEY,
  event_name VARCHAR(100) NOT NULL,
  block_number BIGINT NOT NULL,
  transaction_hash VARCHAR(66) NOT NULL,
  log_index INTEGER NOT NULL,
  args JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Enforce idempotency per log
ALTER TABLE contract_events
  ADD CONSTRAINT contract_events_unique_tx_log UNIQUE (transaction_hash, log_index);

-- 3. Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_contract_events_name         ON contract_events(event_name);
CREATE INDEX IF NOT EXISTS idx_contract_events_block_number ON contract_events(block_number);
CREATE INDEX IF NOT EXISTS idx_contract_events_tx_hash      ON contract_events(transaction_hash);

-- 4. Trigger to auto-update an updated_at column (if/when added)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_contract_events_updated_at'
  ) THEN
    CREATE TRIGGER update_contract_events_updated_at
      BEFORE UPDATE ON contract_events
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMIT;
