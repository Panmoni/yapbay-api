-- Migration: Add Solana-specific fields to transactions table
-- Date: 2025-01-01 00:00:02
-- Description: Add Solana-specific fields to transactions table for multi-network support

BEGIN;

-- Add Solana-specific fields to transactions table
ALTER TABLE transactions ADD COLUMN network_family VARCHAR(10) DEFAULT 'evm' CHECK (network_family IN ('evm', 'solana'));
ALTER TABLE transactions ADD COLUMN signature VARCHAR(88); -- Solana transaction signature
ALTER TABLE transactions ADD COLUMN slot BIGINT; -- Solana slot number

-- Add indexes for Solana fields
CREATE INDEX idx_transactions_network_family ON transactions(network_family);
CREATE INDEX idx_transactions_signature ON transactions(signature);
CREATE INDEX idx_transactions_slot ON transactions(slot);

-- Update transaction_type enum to include Solana-specific types
ALTER TYPE transaction_type ADD VALUE 'INITIALIZE_BUYER_BOND';
ALTER TYPE transaction_type ADD VALUE 'INITIALIZE_SELLER_BOND';
ALTER TYPE transaction_type ADD VALUE 'UPDATE_SEQUENTIAL_ADDRESS';
ALTER TYPE transaction_type ADD VALUE 'AUTO_CANCEL';

COMMIT;
