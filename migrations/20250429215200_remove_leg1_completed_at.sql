-- Migration: Remove leg1_completed_at column from trades table
-- Date: 2025-04-29 21:52:00

-- Remove leg1_completed_at column from trades table if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'trades' AND column_name = 'leg1_completed_at'
    ) THEN
        ALTER TABLE trades DROP COLUMN leg1_completed_at;
    END IF;
END $$;
