-- Add version field to escrows table
ALTER TABLE escrows ADD COLUMN version VARCHAR(50);

-- Add comment explaining the version field
COMMENT ON COLUMN escrows.version IS 'The version of the escrow contract that created this escrow. Extracted from the EscrowCreated event.';

-- Add index for version lookups
CREATE INDEX idx_escrows_version ON escrows(version); 