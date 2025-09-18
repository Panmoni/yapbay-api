-- schema_migrations table to track schema changes
CREATE TABLE schema_migrations (
    version VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT,
    dirty BOOLEAN NOT NULL DEFAULT FALSE
);

-- Drop existing tables to ensure clean setup
DROP TABLE IF EXISTS dispute_resolutions CASCADE;
DROP TABLE IF EXISTS dispute_evidence CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS contract_auto_cancellations CASCADE;
DROP TABLE IF EXISTS escrow_id_mapping CASCADE;
DROP TABLE IF EXISTS escrows CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS trade_cancellations CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS offers CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS contract_events CASCADE;
DROP TABLE IF EXISTS networks CASCADE;

-- Drop existing types to ensure clean setup
DROP TYPE IF EXISTS network_type CASCADE;
DROP TYPE IF EXISTS transaction_status CASCADE;
DROP TYPE IF EXISTS transaction_type CASCADE;

-- Create network enum type
CREATE TYPE network_type AS ENUM (
    'celo-alfajores', 
    'celo-mainnet',
    'solana-devnet',
    'solana-mainnet'
);

-- Create transaction types
CREATE TYPE transaction_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
CREATE TYPE transaction_type AS ENUM (
    'CREATE_ESCROW',
    'FUND_ESCROW',
    'RELEASE_ESCROW',
    'CANCEL_ESCROW',
    'MARK_FIAT_PAID',
    'OPEN_DISPUTE',
    'RESPOND_DISPUTE',
    'RESOLVE_DISPUTE',
    'EVENT',
    'INITIALIZE_BUYER_BOND',
    'INITIALIZE_SELLER_BOND',
    'UPDATE_SEQUENTIAL_ADDRESS',
    'AUTO_CANCEL',
    'OTHER'
);

-- 1. networks: Network configuration table
CREATE TABLE networks (
    id SERIAL PRIMARY KEY,
    name network_type UNIQUE NOT NULL,
    chain_id INTEGER UNIQUE NOT NULL,
    rpc_url TEXT NOT NULL,
    ws_url TEXT,
    contract_address VARCHAR(42), -- EVM only
    program_id VARCHAR(44), -- Solana only
    usdc_mint VARCHAR(44), -- Solana only
    arbitrator_address VARCHAR(44), -- Network-specific arbitrator
    is_testnet BOOLEAN NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    network_family VARCHAR(10) NOT NULL DEFAULT 'evm' CHECK (network_family IN ('evm', 'solana')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. accounts: User profiles and wallet info
CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(44) UNIQUE NOT NULL, -- EVM address (0x... = 42 chars) or Solana address (44 chars)
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    telegram_username VARCHAR(50),
    telegram_id BIGINT,
    profile_photo_url TEXT,
    phone_country_code VARCHAR(5),
    phone_number VARCHAR(15),
    available_from TIME,
    available_to TIME,
    timezone VARCHAR(50),
    role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. offers: Buy/sell offers for crypto-fiat trades
CREATE TABLE offers (
    id SERIAL PRIMARY KEY,
    creator_account_id INTEGER NOT NULL REFERENCES accounts(id),
    network_id INTEGER NOT NULL REFERENCES networks(id),
    offer_type VARCHAR(4) NOT NULL CHECK (offer_type IN ('BUY', 'SELL')),
    token VARCHAR(10) NOT NULL DEFAULT 'USDC',
    fiat_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    min_amount DECIMAL(15,6) NOT NULL, -- USDC uses 6 decimals
    max_amount DECIMAL(15,6) NOT NULL CHECK (max_amount >= min_amount),
    total_available_amount DECIMAL(15,6) NOT NULL CHECK (total_available_amount >= max_amount),
    rate_adjustment DECIMAL(6,4) NOT NULL,
    terms TEXT,
    escrow_deposit_time_limit INTERVAL NOT NULL DEFAULT '15 minutes',
    fiat_payment_time_limit INTERVAL NOT NULL DEFAULT '30 minutes',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. trades: Tracks trades with leg1 and leg2 details
CREATE TABLE trades (
    id SERIAL PRIMARY KEY,
    leg1_offer_id INTEGER REFERENCES offers(id),
    leg2_offer_id INTEGER REFERENCES offers(id),
    network_id INTEGER NOT NULL REFERENCES networks(id),
    overall_status VARCHAR(20) NOT NULL CHECK (overall_status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED')),
    from_fiat_currency VARCHAR(3) NOT NULL,
    destination_fiat_currency VARCHAR(3) NOT NULL,
    from_bank VARCHAR(50),
    destination_bank VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Leg 1 (Buy Leg)
    leg1_state VARCHAR(25) NOT NULL CHECK (leg1_state IN ('CREATED', 'FUNDED', 'FIAT_PAID', 'RELEASED', 'CANCELLED', 'DISPUTED', 'RESOLVED')),
    leg1_seller_account_id INTEGER REFERENCES accounts(id),
    leg1_buyer_account_id INTEGER REFERENCES accounts(id),
    leg1_crypto_token VARCHAR(10) NOT NULL DEFAULT 'USDC',
    leg1_crypto_amount DECIMAL(15,6) NOT NULL,
    leg1_fiat_amount DECIMAL(15,2),
    leg1_fiat_currency VARCHAR(3) NOT NULL,
    leg1_escrow_address VARCHAR(44), -- Not unique as all escrows use the same contract address
    leg1_created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    leg1_escrow_deposit_deadline TIMESTAMP WITH TIME ZONE,
    leg1_fiat_payment_deadline TIMESTAMP WITH TIME ZONE,
    leg1_fiat_paid_at TIMESTAMP WITH TIME ZONE,
    leg1_released_at TIMESTAMP WITH TIME ZONE,
    leg1_cancelled_at TIMESTAMP WITH TIME ZONE,
    leg1_cancelled_by VARCHAR(44),
    leg1_dispute_id INTEGER,
    leg1_escrow_onchain_id VARCHAR(42), -- The on-chain escrow ID (from the EscrowCreated event) for leg 1.

    -- Leg 2 (Sell Leg, optional)
    leg2_state VARCHAR(25) CHECK (leg2_state IN ('CREATED', 'FUNDED', 'FIAT_PAID', 'RELEASED', 'CANCELLED', 'DISPUTED', 'RESOLVED')),
    leg2_seller_account_id INTEGER REFERENCES accounts(id),
    leg2_buyer_account_id INTEGER REFERENCES accounts(id),
    leg2_crypto_token VARCHAR(10) DEFAULT 'USDC',
    leg2_crypto_amount DECIMAL(15,6),
    leg2_fiat_amount DECIMAL(15,2),
    leg2_fiat_currency VARCHAR(3),
    leg2_escrow_address VARCHAR(44), -- Not unique as all escrows use the same contract address
    leg2_created_at TIMESTAMP WITH TIME ZONE,
    leg2_escrow_deposit_deadline TIMESTAMP WITH TIME ZONE,
    leg2_fiat_payment_deadline TIMESTAMP WITH TIME ZONE,
    leg2_fiat_paid_at TIMESTAMP WITH TIME ZONE,
    leg2_released_at TIMESTAMP WITH TIME ZONE,
    leg2_cancelled_at TIMESTAMP WITH TIME ZONE,
    leg2_cancelled_by VARCHAR(44),
    leg2_dispute_id INTEGER,
    leg2_escrow_onchain_id VARCHAR(42), -- The on-chain escrow ID (from the EscrowCreated event) for leg 2.
    
    -- Trade completion tracking
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMP WITH TIME ZONE,
    cancelled BOOLEAN NOT NULL DEFAULT FALSE
);

-- 5. escrows: Tracks on-chain escrow state
CREATE TABLE escrows (
    id SERIAL PRIMARY KEY,
    trade_id INTEGER NOT NULL REFERENCES trades(id),
    network_id INTEGER NOT NULL REFERENCES networks(id),
    escrow_address VARCHAR(44) NOT NULL, -- Contract address (not unique as all escrows use the same contract)
    onchain_escrow_id VARCHAR(42), -- The escrow ID from the blockchain, which is different from the database ID
    seller_address VARCHAR(44) NOT NULL,
    buyer_address VARCHAR(44) NOT NULL,
    arbitrator_address VARCHAR(44) NOT NULL,
    token_type VARCHAR(10) NOT NULL DEFAULT 'USDC',
    amount DECIMAL(15,6) NOT NULL CHECK (amount <= 100.0),
    current_balance DECIMAL(15,6),
    state VARCHAR(20) NOT NULL CHECK (state IN ('CREATED', 'FUNDED', 'RELEASED', 'CANCELLED', 'AUTO_CANCELLED', 'DISPUTED', 'RESOLVED')),
    sequential BOOLEAN NOT NULL,
    sequential_escrow_address VARCHAR(44),
    fiat_paid BOOLEAN NOT NULL DEFAULT FALSE,
    counter INTEGER NOT NULL DEFAULT 0,
    deposit_deadline TIMESTAMP WITH TIME ZONE,
    fiat_deadline TIMESTAMP WITH TIME ZONE,
    dispute_id INTEGER,
    completed_at TIMESTAMP WITH TIME ZONE,
    version VARCHAR(50), -- The version of the escrow contract that created this escrow
    
    -- Network family and Solana-specific fields
    network_family VARCHAR(10) NOT NULL DEFAULT 'evm' CHECK (network_family IN ('evm', 'solana')),
    program_id VARCHAR(44), -- Solana program ID
    escrow_pda VARCHAR(44), -- Solana PDA address
    escrow_token_account VARCHAR(44), -- Solana token account
    escrow_onchain_id VARCHAR(20), -- Solana escrow ID (u64 as string)
    trade_onchain_id VARCHAR(20), -- Solana trade ID (u64 as string)
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. disputes: Tracks dispute lifecycle
CREATE TABLE disputes (
    id SERIAL PRIMARY KEY,
    trade_id INTEGER NOT NULL REFERENCES trades(id),
    escrow_id INTEGER NOT NULL REFERENCES escrows(id),
    network_id INTEGER NOT NULL REFERENCES networks(id),
    initiator_address VARCHAR(44) NOT NULL,
    bond_amount DECIMAL(15,6) NOT NULL CHECK (bond_amount > 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('OPENED', 'RESPONDED', 'RESOLVED', 'DEFAULTED')),
    initiated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    winner_address VARCHAR(44),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. dispute_evidence: Stores evidence metadata
CREATE TABLE dispute_evidence (
    id SERIAL PRIMARY KEY,
    dispute_id INTEGER NOT NULL REFERENCES disputes(id),
    escrow_id INTEGER NOT NULL REFERENCES escrows(id),
    trade_id INTEGER NOT NULL REFERENCES trades(id),
    network_id INTEGER NOT NULL REFERENCES networks(id),
    submitter_address VARCHAR(44) NOT NULL,
    submission_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    evidence_text TEXT NOT NULL CHECK (LENGTH(evidence_text) <= 1000),
    pdf_s3_path TEXT NOT NULL,
    evidence_hash VARCHAR(64) NOT NULL,
    is_initial_submission BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. transactions: on-chain transaction log
CREATE TABLE transactions (
    id BIGSERIAL PRIMARY KEY,
    network_id INTEGER NOT NULL REFERENCES networks(id),
    transaction_hash VARCHAR(88), -- EVM transaction hash (0x + 64 hex chars = 66 chars) or Solana signature (up to 88 chars)
    signature VARCHAR(88), -- Solana transaction signature (base58 encoded, up to 88 chars)
    status transaction_status NOT NULL DEFAULT 'PENDING',
    type transaction_type NOT NULL,
    block_number BIGINT, -- EVM block number
    slot BIGINT, -- Solana slot number
    sender_address VARCHAR(44),
    receiver_or_contract_address VARCHAR(44),
    gas_used DECIMAL(20,0),
    error_message TEXT,
    related_trade_id INTEGER REFERENCES trades(id) ON DELETE SET NULL,
    related_escrow_db_id INTEGER REFERENCES escrows(id) ON DELETE SET NULL,
    network_family VARCHAR(10) NOT NULL DEFAULT 'evm' CHECK (network_family IN ('evm', 'solana')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_trade_id ON transactions(related_trade_id);
CREATE INDEX idx_transactions_escrow_db_id ON transactions(related_escrow_db_id);
CREATE INDEX idx_transactions_hash ON transactions(transaction_hash);
CREATE INDEX idx_transactions_updated_at ON transactions(updated_at);

-- 9. dispute_resolutions: Logs arbitration outcomes
CREATE TABLE dispute_resolutions (
    id SERIAL PRIMARY KEY,
    dispute_id INTEGER NOT NULL REFERENCES disputes(id),
    escrow_id INTEGER NOT NULL REFERENCES escrows(id),
    network_id INTEGER NOT NULL REFERENCES networks(id),
    arbitrator_address VARCHAR(44) NOT NULL,
    resolution_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decision BOOLEAN NOT NULL, -- true: buyer wins, false: seller wins
    decision_explanation TEXT NOT NULL CHECK (LENGTH(decision_explanation) <= 2000),
    decision_hash VARCHAR(64) NOT NULL,
    winner_address VARCHAR(44) NOT NULL,
    funds_destination VARCHAR(44) NOT NULL,
    bond_allocation VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. contract_events: captures blockchain events
CREATE TABLE contract_events (
    id SERIAL PRIMARY KEY,
    network_id INTEGER NOT NULL REFERENCES networks(id),
    event_name VARCHAR(100) NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(88) NOT NULL, -- EVM transaction hash or Solana signature (up to 88 chars)
    log_index INTEGER NOT NULL,
    args JSONB NOT NULL,
    trade_id BIGINT,
    transaction_id BIGINT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT contract_events_unique_tx_log_network UNIQUE (transaction_hash, log_index, network_id),
    CONSTRAINT fk_contract_events_transaction_id FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX idx_contract_events_name ON contract_events(event_name);
CREATE INDEX idx_contract_events_block_number ON contract_events(block_number);
CREATE INDEX idx_contract_events_tx_hash ON contract_events(transaction_hash);
CREATE INDEX idx_contract_events_trade_id ON contract_events(trade_id);

-- 11. trade_cancellations: audit trail for auto-cancels
CREATE TABLE trade_cancellations (
    id SERIAL PRIMARY KEY,
    trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    network_id INTEGER NOT NULL REFERENCES networks(id),
    actor VARCHAR(50) NOT NULL,
    deadline_field VARCHAR(64) NOT NULL,
    cancelled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trade_cancellations_trade_id ON trade_cancellations(trade_id);

-- 12. contract_auto_cancellations: Tracks automatic escrow cancellations performed by the monitoring service
CREATE TABLE contract_auto_cancellations (
    id SERIAL PRIMARY KEY,
    escrow_id INTEGER NOT NULL,
    network_id INTEGER NOT NULL REFERENCES networks(id),
    transaction_hash VARCHAR(88), -- EVM transaction hash or Solana signature (up to 88 chars)
    gas_used INTEGER,
    gas_price BIGINT,
    status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'PENDING')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient querying by escrow_id
CREATE INDEX idx_contract_auto_cancellations_escrow_id 
    ON contract_auto_cancellations(escrow_id);

-- Index for querying by status
CREATE INDEX idx_contract_auto_cancellations_status 
    ON contract_auto_cancellations(status);

-- Index for time-based queries
CREATE INDEX idx_contract_auto_cancellations_created_at 
    ON contract_auto_cancellations(created_at);

-- Index for transaction hash lookups
CREATE INDEX idx_contract_auto_cancellations_tx_hash 
    ON contract_auto_cancellations(transaction_hash);

COMMENT ON TABLE contract_auto_cancellations IS 'Tracks automatic escrow cancellations performed by the monitoring service';
COMMENT ON COLUMN contract_auto_cancellations.escrow_id IS 'The blockchain escrow ID that was cancelled';
COMMENT ON COLUMN contract_auto_cancellations.transaction_hash IS 'The blockchain transaction hash of the cancellation';
COMMENT ON COLUMN contract_auto_cancellations.gas_used IS 'Amount of gas used for the transaction';
COMMENT ON COLUMN contract_auto_cancellations.gas_price IS 'Gas price in wei for the transaction';
COMMENT ON COLUMN contract_auto_cancellations.status IS 'Status of the cancellation attempt: SUCCESS, FAILED, or PENDING';
COMMENT ON COLUMN contract_auto_cancellations.error_message IS 'Error message if the cancellation failed';

-- 13. escrow_id_mapping: Maps blockchain escrow IDs to database escrow IDs for better synchronization
CREATE TABLE escrow_id_mapping (
  id SERIAL PRIMARY KEY,
  blockchain_id VARCHAR(255) NOT NULL,
  database_id INTEGER NOT NULL,
  network_id INTEGER NOT NULL REFERENCES networks(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_database_id FOREIGN KEY (database_id) REFERENCES escrows(id) ON DELETE CASCADE,
  CONSTRAINT escrow_id_mapping_blockchain_network_unique UNIQUE (blockchain_id, network_id)
);

-- Create index for faster lookups
CREATE INDEX idx_escrow_id_mapping_blockchain_id ON escrow_id_mapping(blockchain_id);
CREATE INDEX idx_escrow_id_mapping_database_id ON escrow_id_mapping(database_id);

-- Network-related indexes
CREATE INDEX idx_networks_network_family ON networks(network_family);
CREATE INDEX idx_networks_program_id ON networks(program_id);
CREATE INDEX idx_networks_is_active ON networks(is_active);

-- Network ID indexes for all tables
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

-- Solana-specific indexes
CREATE INDEX idx_escrows_network_family ON escrows(network_family);
CREATE INDEX idx_escrows_program_id ON escrows(program_id);
CREATE INDEX idx_escrows_escrow_pda ON escrows(escrow_pda);
CREATE INDEX idx_escrows_escrow_onchain_id ON escrows(escrow_onchain_id);
CREATE INDEX idx_transactions_network_family ON transactions(network_family);
CREATE INDEX idx_transactions_signature ON transactions(signature);
CREATE INDEX idx_transactions_slot ON transactions(slot);

-- Compound indexes for commonly queried combinations
CREATE INDEX idx_offers_network_type ON offers(network_id, offer_type);
CREATE INDEX idx_trades_network_status ON trades(network_id, overall_status);
CREATE INDEX idx_escrows_network_state ON escrows(network_id, state);
CREATE INDEX idx_transactions_network_status ON transactions(network_id, status);
CREATE INDEX idx_contract_events_network_name ON contract_events(network_id, event_name);

-- Existing indexes
CREATE INDEX idx_accounts_wallet_address ON accounts(wallet_address);
CREATE INDEX idx_offers_creator_account_id ON offers(creator_account_id);
CREATE INDEX idx_trades_overall_status ON trades(overall_status);
CREATE INDEX idx_trades_leg1_escrow_address ON trades(leg1_escrow_address);
CREATE INDEX idx_trades_leg1_escrow_onchain_id ON trades(leg1_escrow_onchain_id);
CREATE INDEX idx_trades_leg2_escrow_address ON trades(leg2_escrow_address);
CREATE INDEX idx_trades_leg2_escrow_onchain_id ON trades(leg2_escrow_onchain_id);
CREATE INDEX idx_escrows_trade_id ON escrows(trade_id);
CREATE INDEX idx_escrows_escrow_address ON escrows(escrow_address);
CREATE INDEX idx_escrows_onchain_escrow_id ON escrows(onchain_escrow_id);
CREATE INDEX idx_escrows_state ON escrows(state);
CREATE INDEX idx_escrows_current_balance ON escrows(current_balance);
CREATE INDEX idx_escrows_completed_at ON escrows(completed_at);
CREATE INDEX idx_trades_completed ON trades(completed);
CREATE INDEX idx_trades_completed_at ON trades(completed_at);
CREATE INDEX idx_trades_cancelled ON trades(cancelled);
CREATE INDEX idx_disputes_escrow_id ON disputes(escrow_id);
CREATE INDEX idx_disputes_trade_id ON disputes(trade_id);
CREATE INDEX idx_dispute_evidence_dispute_id ON dispute_evidence(dispute_id);
CREATE INDEX idx_dispute_resolutions_dispute_id ON dispute_resolutions(dispute_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_networks_updated_at
    BEFORE UPDATE ON networks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_offers_updated_at
    BEFORE UPDATE ON offers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trades_updated_at
    BEFORE UPDATE ON trades
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_escrows_updated_at
    BEFORE UPDATE ON escrows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dispute_evidence_updated_at
    BEFORE UPDATE ON dispute_evidence
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dispute_resolutions_updated_at
    BEFORE UPDATE ON dispute_resolutions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contract_events_updated_at
    BEFORE UPDATE ON contract_events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trade_cancellations_updated_at
    BEFORE UPDATE ON trade_cancellations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_escrow_id_mapping_updated_at
    BEFORE UPDATE ON escrow_id_mapping
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contract_auto_cancellations_updated_at
    BEFORE UPDATE ON contract_auto_cancellations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- 14. enforce trade deadlines: block state updates past deadlines
CREATE OR REPLACE FUNCTION enforce_trade_deadlines()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow cancellations and legitimate completions
  IF NEW.overall_status != 'CANCELLED' THEN
    -- Leg 1 escrow deposit deadline - allow RELEASED and COMPLETED states
    IF NEW.leg1_escrow_deposit_deadline IS NOT NULL
       AND NEW.leg1_escrow_deposit_deadline <= NOW()
       AND NEW.leg1_state NOT IN ('RELEASED', 'COMPLETED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Leg1 escrow deposit deadline (% ) passed', NEW.leg1_escrow_deposit_deadline;
    END IF;
    
    -- Leg 1 fiat payment deadline - allow RELEASED and COMPLETED states
    IF NEW.leg1_fiat_payment_deadline IS NOT NULL
       AND NEW.leg1_fiat_payment_deadline <= NOW()
       AND NEW.leg1_state NOT IN ('RELEASED', 'COMPLETED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Leg1 fiat payment deadline (% ) passed', NEW.leg1_fiat_payment_deadline;
    END IF;
    
    -- Leg 2 escrow deposit deadline - allow RELEASED and COMPLETED states
    IF NEW.leg2_escrow_deposit_deadline IS NOT NULL
       AND NEW.leg2_escrow_deposit_deadline <= NOW()
       AND NEW.leg2_state NOT IN ('RELEASED', 'COMPLETED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Leg2 escrow deposit deadline (% ) passed', NEW.leg2_escrow_deposit_deadline;
    END IF;
    
    -- Leg 2 fiat payment deadline - allow RELEASED and COMPLETED states
    IF NEW.leg2_fiat_payment_deadline IS NOT NULL
       AND NEW.leg2_fiat_payment_deadline <= NOW()
       AND NEW.leg2_state NOT IN ('RELEASED', 'COMPLETED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Leg2 fiat payment deadline (% ) passed', NEW.leg2_fiat_payment_deadline;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_trade_deadlines
  BEFORE UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION enforce_trade_deadlines();

-- Foreign key constraints
ALTER TABLE trades
    ADD CONSTRAINT fk_leg1_dispute FOREIGN KEY (leg1_dispute_id) REFERENCES disputes(id),
    ADD CONSTRAINT fk_leg2_dispute FOREIGN KEY (leg2_dispute_id) REFERENCES disputes(id);

ALTER TABLE escrows
    ADD CONSTRAINT fk_dispute FOREIGN KEY (dispute_id) REFERENCES disputes(id),
    ADD CONSTRAINT escrows_trade_id_id_unique UNIQUE (trade_id, id);

-- Network-aware unique constraints
-- Ensure escrow onchain IDs are unique within a network
CREATE UNIQUE INDEX idx_unique_trade_onchain_escrow_network 
ON escrows (trade_id, onchain_escrow_id, network_id) 
WHERE onchain_escrow_id IS NOT NULL;

-- Simple unique constraints that work with ON CONFLICT
-- For EVM networks: transaction_hash must be unique within network
CREATE UNIQUE INDEX idx_transactions_hash_network ON transactions(transaction_hash, network_id);

-- For Solana networks: signature must be unique within network  
CREATE UNIQUE INDEX idx_transactions_signature_network ON transactions(signature, network_id);

-- Ensure contract events are unique within network
CREATE UNIQUE INDEX idx_contract_events_unique_tx_log_network 
ON contract_events(transaction_hash, log_index, network_id);

-- Ensure escrow ID mapping is unique within a network
CREATE UNIQUE INDEX idx_escrow_id_mapping_blockchain_network 
ON escrow_id_mapping(blockchain_id, network_id);

-- Add comments explaining the indexes
COMMENT ON INDEX idx_unique_trade_onchain_escrow_network IS 
'Ensures that there is only one escrow record per trade_id and onchain_escrow_id combination within a network. This prevents duplicate escrow records from being created by different processes.';

-- Insert network configurations
INSERT INTO networks (name, chain_id, rpc_url, ws_url, contract_address, is_testnet, is_active, network_family, program_id, usdc_mint, arbitrator_address) VALUES
-- Celo networks (disabled temporarily)
('celo-alfajores', 44787, 'https://alfajores-forno.celo-testnet.org', 'wss://alfajores-forno.celo-testnet.org/ws', '0xE68cf67df40B3d93Be6a10D0A18d0846381Cbc0E', true, false, 'evm', NULL, NULL, '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383'),
('celo-mainnet', 42220, 'https://forno.celo.org', 'wss://forno.celo.org/ws', '0xf8C832021350133769EE5E0605a9c40c1765ace7', false, false, 'evm', NULL, NULL, '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383'),
-- Solana networks (using unique chain_ids since Solana doesn't use traditional chain IDs)
('solana-devnet', 101, 'https://distinguished-chaotic-bird.solana-devnet.quiknode.pro/483d675967ac17c1970a9b07fdba88abe17d421e/', NULL, NULL, true, true, 'solana', '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr'),
('solana-mainnet', 102, 'https://api.mainnet-beta.solana.com', NULL, NULL, false, false, 'solana', '', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr');

-- Add comments explaining the network support
COMMENT ON TABLE networks IS 'Configuration for supported blockchain networks';
COMMENT ON COLUMN networks.name IS 'Unique network identifier matching the network_type enum';
COMMENT ON COLUMN networks.chain_id IS 'Blockchain chain ID (e.g., 44787 for Alfajores, 42220 for Celo Mainnet, 0 for Solana)';
COMMENT ON COLUMN networks.contract_address IS 'YapBay escrow contract address on this network (EVM only)';
COMMENT ON COLUMN networks.program_id IS 'YapBay program ID on this network (Solana only)';
COMMENT ON COLUMN networks.usdc_mint IS 'USDC mint address on this network (Solana only)';
COMMENT ON COLUMN networks.arbitrator_address IS 'Arbitrator address for this network';
COMMENT ON COLUMN networks.is_testnet IS 'Whether this is a testnet (true) or mainnet (false)';
COMMENT ON COLUMN networks.is_active IS 'Whether this network is currently active and accepting new operations';
COMMENT ON COLUMN networks.network_family IS 'Network family: evm for Ethereum-compatible chains, solana for Solana';