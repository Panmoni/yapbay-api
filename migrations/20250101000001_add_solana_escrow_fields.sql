-- Migration: Add Solana-specific fields to escrows table
-- Date: 2025-01-01 00:00:01
-- Description: Add Solana-specific fields to escrows table for multi-network support

BEGIN;

-- Add Solana-specific fields to escrows table
ALTER TABLE escrows ADD COLUMN network_family VARCHAR(10) DEFAULT 'evm' CHECK (network_family IN ('evm', 'solana'));
ALTER TABLE escrows ADD COLUMN program_id VARCHAR(44); -- Solana program ID
ALTER TABLE escrows ADD COLUMN escrow_pda VARCHAR(44); -- Solana PDA address
ALTER TABLE escrows ADD COLUMN escrow_token_account VARCHAR(44); -- Solana token account
ALTER TABLE escrows ADD COLUMN escrow_onchain_id VARCHAR(20); -- Solana escrow ID (u64 as string)
ALTER TABLE escrows ADD COLUMN trade_onchain_id VARCHAR(20); -- Solana trade ID (u64 as string)

-- Add indexes for Solana fields
CREATE INDEX idx_escrows_network_family ON escrows(network_family);
CREATE INDEX idx_escrows_program_id ON escrows(program_id);
CREATE INDEX idx_escrows_escrow_pda ON escrows(escrow_pda);
CREATE INDEX idx_escrows_escrow_onchain_id ON escrows(escrow_onchain_id);

COMMIT;
