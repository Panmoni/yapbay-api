-- Migration to add unique constraint on trade_id and onchain_escrow_id
-- This prevents duplicate escrow records for the same trade and blockchain escrow

-- First, clean up any potential duplicate records before adding the constraint
-- Find duplicates
DO $$
DECLARE
    duplicate_record RECORD;
BEGIN
    -- Find all combinations of trade_id and onchain_escrow_id that have more than one record
    FOR duplicate_record IN 
        SELECT trade_id, onchain_escrow_id, COUNT(*) as count, 
               array_agg(id ORDER BY created_at DESC) as escrow_ids
        FROM escrows
        WHERE onchain_escrow_id IS NOT NULL
        GROUP BY trade_id, onchain_escrow_id
        HAVING COUNT(*) > 1
    LOOP
        -- Keep the most recent record (first in the array) and delete the others
        RAISE NOTICE 'Found % duplicate escrows for trade_id=% and onchain_escrow_id=%', 
                     duplicate_record.count, duplicate_record.trade_id, duplicate_record.onchain_escrow_id;
        
        -- Delete all but the first (most recent) escrow
        EXECUTE 'DELETE FROM escrows WHERE id = ANY($1) AND id != $2'
        USING duplicate_record.escrow_ids, duplicate_record.escrow_ids[1];
        
        RAISE NOTICE 'Kept escrow id=% and deleted the rest', duplicate_record.escrow_ids[1];
    END LOOP;
END $$;

-- Create a unique index with a WHERE condition instead of a constraint with WHERE
CREATE UNIQUE INDEX idx_unique_trade_onchain_escrow 
ON escrows (trade_id, onchain_escrow_id) 
WHERE onchain_escrow_id IS NOT NULL;

-- Add comment explaining the index
COMMENT ON INDEX idx_unique_trade_onchain_escrow IS 
'Ensures that there is only one escrow record per trade_id and onchain_escrow_id combination. This prevents duplicate escrow records from being created by different processes.';
