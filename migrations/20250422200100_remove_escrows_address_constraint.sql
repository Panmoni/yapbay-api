-- Remove the unique constraint on escrow_address in the escrows table
ALTER TABLE escrows DROP CONSTRAINT IF EXISTS escrows_escrow_address_key;

-- Add a comment explaining why this constraint was removed
COMMENT ON COLUMN escrows.escrow_address IS 'The address of the escrow contract. This is not unique as all escrows use the same contract address.';

-- Add onchain_escrow_id column to store the blockchain escrow ID
ALTER TABLE escrows ADD COLUMN onchain_escrow_id VARCHAR(42);

-- Add an index on onchain_escrow_id for faster lookups
CREATE INDEX idx_escrows_onchain_escrow_id ON escrows(onchain_escrow_id);

-- Add a comment explaining the purpose of the new column
COMMENT ON COLUMN escrows.onchain_escrow_id IS 'The escrow ID from the blockchain, which is different from the database ID.';