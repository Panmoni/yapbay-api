-- Migration: Add updated_at column to transactions table
-- Date: 2025-01-18
-- Description: Add missing updated_at column to transactions table to fix trigger error

-- Add the updated_at column to transactions table
ALTER TABLE transactions 
ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Update existing records to use created_at as updated_at
UPDATE transactions 
SET updated_at = created_at 
WHERE updated_at IS NULL;

-- Add index for performance if needed
CREATE INDEX IF NOT EXISTS idx_transactions_updated_at ON transactions(updated_at);

-- Add comment explaining the column
COMMENT ON COLUMN transactions.updated_at IS 'Timestamp when the transaction record was last updated';
