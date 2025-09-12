-- Migration: Extend remaining address columns for Solana addresses
-- Date: 2025-09-12 00:00:02
-- Description: Increase length of remaining address columns to support 44-character Solana addresses

BEGIN;

-- Extend address columns in trades table
ALTER TABLE trades ALTER COLUMN leg1_cancelled_by TYPE VARCHAR(44);
ALTER TABLE trades ALTER COLUMN leg2_cancelled_by TYPE VARCHAR(44);

-- Extend address columns in disputes table
ALTER TABLE disputes ALTER COLUMN initiator_address TYPE VARCHAR(44);
ALTER TABLE disputes ALTER COLUMN winner_address TYPE VARCHAR(44);

-- Extend address columns in dispute_evidence table
ALTER TABLE dispute_evidence ALTER COLUMN submitter_address TYPE VARCHAR(44);

-- Extend address columns in transactions table
ALTER TABLE transactions ALTER COLUMN sender_address TYPE VARCHAR(44);
ALTER TABLE transactions ALTER COLUMN receiver_or_contract_address TYPE VARCHAR(44);

-- Extend address columns in dispute_resolutions table
ALTER TABLE dispute_resolutions ALTER COLUMN winner_address TYPE VARCHAR(44);
ALTER TABLE dispute_resolutions ALTER COLUMN funds_destination TYPE VARCHAR(44);

COMMIT;
