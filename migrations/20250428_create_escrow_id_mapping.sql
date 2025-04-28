-- Migration to create escrow_id_mapping table
-- This table helps synchronize blockchain escrow IDs with database escrow IDs

CREATE TABLE IF NOT EXISTS escrow_id_mapping (
  id SERIAL PRIMARY KEY,
  blockchain_id VARCHAR(255) NOT NULL UNIQUE,
  database_id INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_database_id FOREIGN KEY (database_id) REFERENCES escrows(id) ON DELETE CASCADE
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_escrow_id_mapping_blockchain_id ON escrow_id_mapping(blockchain_id);
CREATE INDEX IF NOT EXISTS idx_escrow_id_mapping_database_id ON escrow_id_mapping(database_id);

-- Add comment to explain table purpose
COMMENT ON TABLE escrow_id_mapping IS 'Maps blockchain escrow IDs to database escrow IDs for better synchronization';
