-- Migration: Drop divvi_referrals table
-- Created: 2025-01-01
-- This migration removes the divvi_referrals table as it's no longer needed

-- Drop the table and all its dependencies (indexes, triggers, etc.)
DROP TABLE IF EXISTS divvi_referrals CASCADE;
