-- Add EVENT transaction type to the enum
ALTER TYPE transaction_type ADD VALUE 'EVENT';

-- Add current_balance field to escrows table
ALTER TABLE escrows ADD COLUMN current_balance DECIMAL(15,6);

-- Set current_balance based on escrow state
-- For FUNDED or DISPUTED escrows, set balance to amount (they should have funds)
UPDATE escrows SET current_balance = amount WHERE state IN ('FUNDED', 'DISPUTED');

-- For CREATED escrows, set balance to 0 (not yet funded)
UPDATE escrows SET current_balance = 0 WHERE state = 'CREATED';

-- For terminal states (RELEASED, CANCELLED, RESOLVED), set balance to 0 (funds distributed/returned)
UPDATE escrows SET current_balance = 0 WHERE state IN ('RELEASED', 'CANCELLED', 'RESOLVED');

-- For any other states, default to 0
UPDATE escrows SET current_balance = 0 WHERE current_balance IS NULL;

-- Add index for efficient balance queries
CREATE INDEX idx_escrows_current_balance ON escrows(current_balance);