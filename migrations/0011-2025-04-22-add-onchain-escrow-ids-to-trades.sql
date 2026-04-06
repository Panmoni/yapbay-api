-- Migration: Add onchain escrow IDs to trades table
-- Timestamp: 20250422210800

BEGIN; -- Start transaction

-- Add leg1_escrow_onchain_id column to store the blockchain escrow ID for leg 1
ALTER TABLE trades ADD COLUMN leg1_escrow_onchain_id VARCHAR(42);
COMMENT ON COLUMN trades.leg1_escrow_onchain_id IS 'The on-chain escrow ID (from the EscrowCreated event) for leg 1.';

-- Add leg2_escrow_onchain_id column to store the blockchain escrow ID for leg 2
ALTER TABLE trades ADD COLUMN leg2_escrow_onchain_id VARCHAR(42);
COMMENT ON COLUMN trades.leg2_escrow_onchain_id IS 'The on-chain escrow ID (from the EscrowCreated event) for leg 2.';

-- Optional: Add indexes if needed for lookups based on these IDs
CREATE INDEX idx_trades_leg1_escrow_onchain_id ON trades(leg1_escrow_onchain_id);
CREATE INDEX idx_trades_leg2_escrow_onchain_id ON trades(leg2_escrow_onchain_id);

-- Commit changes
COMMIT;