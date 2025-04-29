-- Migration: Add missing columns to fix schema mismatches
-- Date: 2025-04-29 18:01:00

-- Add leg1_completed_at column to trades table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'trades' AND column_name = 'leg1_completed_at'
    ) THEN
        ALTER TABLE trades ADD COLUMN leg1_completed_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add sequential column to escrows table if it doesn't exist
-- Note: This should already exist in schema.sql but appears to be missing in the database
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'escrows' AND column_name = 'sequential'
    ) THEN
        ALTER TABLE escrows ADD COLUMN sequential BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;
