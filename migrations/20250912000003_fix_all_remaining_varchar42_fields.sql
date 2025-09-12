-- Migration: Fix all remaining VARCHAR(42) fields for Solana addresses
-- Date: 2025-09-12 00:00:03
-- Description: Update all remaining VARCHAR(42) address fields to VARCHAR(44) to support Solana addresses

BEGIN;

-- Fix escrows table (these should have been updated in previous migrations but weren't)
ALTER TABLE escrows ALTER COLUMN arbitrator_address TYPE VARCHAR(44);
ALTER TABLE escrows ALTER COLUMN buyer_address TYPE VARCHAR(44);
ALTER TABLE escrows ALTER COLUMN escrow_address TYPE VARCHAR(44);
ALTER TABLE escrows ALTER COLUMN seller_address TYPE VARCHAR(44);
ALTER TABLE escrows ALTER COLUMN sequential_escrow_address TYPE VARCHAR(44);

-- Fix trades table (these should have been updated in previous migrations but weren't)
ALTER TABLE trades ALTER COLUMN leg1_escrow_address TYPE VARCHAR(44);
ALTER TABLE trades ALTER COLUMN leg2_escrow_address TYPE VARCHAR(44);

-- Fix dispute_resolutions table (this should have been updated in previous migrations but wasn't)
ALTER TABLE dispute_resolutions ALTER COLUMN arbitrator_address TYPE VARCHAR(44);

-- Fix divvi_referrals table
ALTER TABLE divvi_referrals ALTER COLUMN wallet_address TYPE VARCHAR(44);

-- Note: networks.contract_address stays VARCHAR(42) as it's for EVM contract addresses
-- Note: escrows.onchain_escrow_id stays VARCHAR(42) as it's a blockchain escrow ID, not a wallet address
-- Note: trades.leg1_escrow_onchain_id and leg2_escrow_onchain_id stay VARCHAR(42) as they're blockchain escrow IDs

COMMIT;
