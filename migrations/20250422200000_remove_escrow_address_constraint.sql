-- Remove the unique constraint on leg1_escrow_address in the trades table
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_leg1_escrow_address_key;

-- Add a comment explaining why this constraint was removed
COMMENT ON COLUMN trades.leg1_escrow_address IS 'The address of the escrow contract. This is not unique as all escrows use the same contract address. The unique identifier for an escrow is the escrow_id from the blockchain.';