-- Migration: Extend wallet_address field to support Solana addresses
-- Date: 2025-09-12 00:00:00
-- Description: Extend wallet_address field from VARCHAR(42) to VARCHAR(44) to support Solana addresses

BEGIN;

-- Extend wallet_address field to support Solana addresses (44 characters)
ALTER TABLE accounts ALTER COLUMN wallet_address TYPE VARCHAR(44);

-- Update the comment to reflect multi-network support
COMMENT ON COLUMN accounts.wallet_address IS 'Wallet address - 42 chars for EVM (0x...), 44 chars for Solana';

COMMIT;
