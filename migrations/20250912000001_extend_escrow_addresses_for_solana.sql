-- Migration: Extend escrow address columns for Solana addresses
-- Date: 2025-09-12 00:00:01
-- Description: Increase length of address columns in escrows and trades tables to support 44-character Solana addresses

BEGIN;

-- Extend escrow address columns in escrows table
ALTER TABLE escrows ALTER COLUMN escrow_address TYPE VARCHAR(44);
ALTER TABLE escrows ALTER COLUMN seller_address TYPE VARCHAR(44);
ALTER TABLE escrows ALTER COLUMN buyer_address TYPE VARCHAR(44);
ALTER TABLE escrows ALTER COLUMN arbitrator_address TYPE VARCHAR(44);
ALTER TABLE escrows ALTER COLUMN sequential_escrow_address TYPE VARCHAR(44);

-- Extend escrow address columns in trades table
ALTER TABLE trades ALTER COLUMN leg1_escrow_address TYPE VARCHAR(44);
ALTER TABLE trades ALTER COLUMN leg2_escrow_address TYPE VARCHAR(44);

-- Extend arbitrator address in disputes table
ALTER TABLE disputes ALTER COLUMN arbitrator_address TYPE VARCHAR(44);

COMMIT;
