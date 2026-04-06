-- Migration: Add Solana networks and disable Celo temporarily
-- Date: 2025-01-01 00:00:00
-- Description: Add Solana network support and disable Celo networks temporarily

BEGIN;

-- Extend network_type enum to include Solana networks
ALTER TYPE network_type ADD VALUE 'solana-devnet';
ALTER TYPE network_type ADD VALUE 'solana-mainnet';

-- Add Solana-specific columns to networks table
ALTER TABLE networks ADD COLUMN network_family VARCHAR(10) DEFAULT 'evm' CHECK (network_family IN ('evm', 'solana'));
ALTER TABLE networks ADD COLUMN program_id VARCHAR(44); -- Solana program ID
ALTER TABLE networks ADD COLUMN usdc_mint VARCHAR(44); -- Solana USDC mint address
ALTER TABLE networks ADD COLUMN arbitrator_address VARCHAR(44); -- Network-specific arbitrator

-- Insert Solana network configurations
INSERT INTO networks (name, chain_id, rpc_url, ws_url, contract_address, is_testnet, is_active, network_family, program_id, usdc_mint, arbitrator_address) VALUES
('solana-devnet', 0, 'https://distinguished-chaotic-bird.solana-devnet.quiknode.pro/483d675967ac17c1970a9b07fdba88abe17d421e/', NULL, NULL, true, true, 'solana', '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr'),
('solana-mainnet', 0, 'https://api.mainnet-beta.solana.com', NULL, NULL, false, false, 'solana', '', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr');

-- Disable existing Celo networks temporarily
UPDATE networks SET is_active = false WHERE name IN ('celo-alfajores', 'celo-mainnet');

-- Add indexes for new columns
CREATE INDEX idx_networks_network_family ON networks(network_family);
CREATE INDEX idx_networks_program_id ON networks(program_id);

COMMIT;
