-- Migration: Add multi-network support
-- Date: 2025-01-31 00:00:00
-- Description: Add network configuration and network_id to all relevant tables

BEGIN;

-- Create network enum type
CREATE TYPE network_type AS ENUM ('celo-alfajores', 'celo-mainnet');

-- Create networks configuration table
CREATE TABLE networks (
    id SERIAL PRIMARY KEY,
    name network_type UNIQUE NOT NULL,
    chain_id INTEGER UNIQUE NOT NULL,
    rpc_url TEXT NOT NULL,
    ws_url TEXT,
    contract_address VARCHAR(42) NOT NULL,
    is_testnet BOOLEAN NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default network configurations
INSERT INTO networks (name, chain_id, rpc_url, ws_url, contract_address, is_testnet, is_active) VALUES
('celo-alfajores', 44787, 'https://alfajores-forno.celo-testnet.org', 'wss://alfajores-forno.celo-testnet.org/ws', '0xE68cf67df40B3d93Be6a10D0A18d0846381Cbc0E', true, true),
('celo-mainnet', 42220, 'https://forno.celo.org', 'wss://forno.celo.org/ws', '0xf8C832021350133769EE5E0605a9c40c1765ace7', false, true);

-- Add network_id column to all network-specific tables
ALTER TABLE offers ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
ALTER TABLE trades ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
ALTER TABLE escrows ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
ALTER TABLE transactions ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
ALTER TABLE contract_events ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
ALTER TABLE contract_auto_cancellations ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
ALTER TABLE disputes ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
ALTER TABLE dispute_evidence ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
ALTER TABLE dispute_resolutions ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
ALTER TABLE trade_cancellations ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);
ALTER TABLE escrow_id_mapping ADD COLUMN network_id INTEGER NOT NULL DEFAULT 1 REFERENCES networks(id);

-- Remove default values after setting them (they should be explicitly set going forward)
ALTER TABLE offers ALTER COLUMN network_id DROP DEFAULT;
ALTER TABLE trades ALTER COLUMN network_id DROP DEFAULT;
ALTER TABLE escrows ALTER COLUMN network_id DROP DEFAULT;
ALTER TABLE transactions ALTER COLUMN network_id DROP DEFAULT;
ALTER TABLE contract_events ALTER COLUMN network_id DROP DEFAULT;
ALTER TABLE contract_auto_cancellations ALTER COLUMN network_id DROP DEFAULT;
ALTER TABLE disputes ALTER COLUMN network_id DROP DEFAULT;
ALTER TABLE dispute_evidence ALTER COLUMN network_id DROP DEFAULT;
ALTER TABLE dispute_resolutions ALTER COLUMN network_id DROP DEFAULT;
ALTER TABLE trade_cancellations ALTER COLUMN network_id DROP DEFAULT;
ALTER TABLE escrow_id_mapping ALTER COLUMN network_id DROP DEFAULT;

-- Create indexes for network_id on all tables for efficient filtering
CREATE INDEX idx_offers_network_id ON offers(network_id);
CREATE INDEX idx_trades_network_id ON trades(network_id);
CREATE INDEX idx_escrows_network_id ON escrows(network_id);
CREATE INDEX idx_transactions_network_id ON transactions(network_id);
CREATE INDEX idx_contract_events_network_id ON contract_events(network_id);
CREATE INDEX idx_contract_auto_cancellations_network_id ON contract_auto_cancellations(network_id);
CREATE INDEX idx_disputes_network_id ON disputes(network_id);
CREATE INDEX idx_dispute_evidence_network_id ON dispute_evidence(network_id);
CREATE INDEX idx_dispute_resolutions_network_id ON dispute_resolutions(network_id);
CREATE INDEX idx_trade_cancellations_network_id ON trade_cancellations(network_id);
CREATE INDEX idx_escrow_id_mapping_network_id ON escrow_id_mapping(network_id);

-- Add compound indexes for commonly queried combinations
CREATE INDEX idx_offers_network_type ON offers(network_id, offer_type);
CREATE INDEX idx_trades_network_status ON trades(network_id, overall_status);
CREATE INDEX idx_escrows_network_state ON escrows(network_id, state);
CREATE INDEX idx_transactions_network_status ON transactions(network_id, status);
CREATE INDEX idx_contract_events_network_name ON contract_events(network_id, event_name);

-- Add updated_at trigger for networks table
CREATE TRIGGER update_networks_updated_at
    BEFORE UPDATE ON networks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add unique constraints to prevent cross-network conflicts
-- Ensure escrow onchain IDs are unique within a network
DROP INDEX IF EXISTS idx_unique_trade_onchain_escrow;
CREATE UNIQUE INDEX idx_unique_trade_onchain_escrow_network 
ON escrows (trade_id, onchain_escrow_id, network_id) 
WHERE onchain_escrow_id IS NOT NULL;

-- Ensure transaction hashes are unique within a network
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transaction_hash_key;
CREATE UNIQUE INDEX idx_transactions_hash_network ON transactions(transaction_hash, network_id);

-- Ensure contract events are unique within a network
ALTER TABLE contract_events DROP CONSTRAINT IF EXISTS contract_events_unique_tx_log;
CREATE UNIQUE INDEX idx_contract_events_unique_tx_log_network 
ON contract_events(transaction_hash, log_index, network_id);

-- Ensure escrow ID mapping is unique within a network
CREATE UNIQUE INDEX idx_escrow_id_mapping_blockchain_network 
ON escrow_id_mapping(blockchain_id, network_id);

-- Add comments explaining the network support
COMMENT ON TABLE networks IS 'Configuration for supported blockchain networks';
COMMENT ON COLUMN networks.name IS 'Unique network identifier matching the network_type enum';
COMMENT ON COLUMN networks.chain_id IS 'Blockchain chain ID (e.g., 44787 for Alfajores, 42220 for Celo Mainnet)';
COMMENT ON COLUMN networks.contract_address IS 'YapBay escrow contract address on this network';
COMMENT ON COLUMN networks.is_testnet IS 'Whether this is a testnet (true) or mainnet (false)';
COMMENT ON COLUMN networks.is_active IS 'Whether this network is currently active and accepting new operations';

COMMIT;