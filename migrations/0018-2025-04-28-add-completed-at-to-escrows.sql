-- Add completed_at column to escrows table
ALTER TABLE escrows
ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE;

-- Update existing RELEASED, CANCELLED, and RESOLVED escrows to have completed_at = updated_at
UPDATE escrows
SET completed_at = updated_at
WHERE state IN ('RELEASED', 'CANCELLED', 'RESOLVED')
  AND completed_at IS NULL;

-- Add an index for the new column
CREATE INDEX idx_escrows_completed_at ON escrows(completed_at);
