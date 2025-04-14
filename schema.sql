-- Drop existing tables to ensure clean setup
DROP TABLE IF EXISTS dispute_resolutions CASCADE;
DROP TABLE IF EXISTS dispute_evidence CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS escrows CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS offers CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;

-- 1. accounts: User profiles and wallet info
CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(42) UNIQUE NOT NULL, -- EVM address (e.g., 0x...)
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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. offers: Buy/sell offers for crypto-fiat trades
CREATE TABLE offers (
    id SERIAL PRIMARY KEY,
    creator_account_id INTEGER NOT NULL REFERENCES accounts(id),
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

-- 3. trades: Tracks trades with leg1 and leg2 details
CREATE TABLE trades (
    id SERIAL PRIMARY KEY,
    leg1_offer_id INTEGER REFERENCES offers(id),
    leg2_offer_id INTEGER REFERENCES offers(id),
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
    leg1_escrow_address VARCHAR(42) UNIQUE,
    leg1_created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    leg1_escrow_deposit_deadline TIMESTAMP WITH TIME ZONE,
    leg1_fiat_payment_deadline TIMESTAMP WITH TIME ZONE,
    leg1_fiat_paid_at TIMESTAMP WITH TIME ZONE,
    leg1_released_at TIMESTAMP WITH TIME ZONE,
    leg1_cancelled_at TIMESTAMP WITH TIME ZONE,
    leg1_cancelled_by VARCHAR(42),
    leg1_dispute_id INTEGER,

    -- Leg 2 (Sell Leg, optional)
    leg2_state VARCHAR(25) CHECK (leg2_state IN ('CREATED', 'FUNDED', 'FIAT_PAID', 'RELEASED', 'CANCELLED', 'DISPUTED', 'RESOLVED')),
    leg2_seller_account_id INTEGER REFERENCES accounts(id),
    leg2_buyer_account_id INTEGER REFERENCES accounts(id),
    leg2_crypto_token VARCHAR(10) DEFAULT 'USDC',
    leg2_crypto_amount DECIMAL(15,6),
    leg2_fiat_amount DECIMAL(15,2),
    leg2_fiat_currency VARCHAR(3),
    leg2_escrow_address VARCHAR(42) UNIQUE,
    leg2_created_at TIMESTAMP WITH TIME ZONE,
    leg2_escrow_deposit_deadline TIMESTAMP WITH TIME ZONE,
    leg2_fiat_payment_deadline TIMESTAMP WITH TIME ZONE,
    leg2_fiat_paid_at TIMESTAMP WITH TIME ZONE,
    leg2_released_at TIMESTAMP WITH TIME ZONE,
    leg2_cancelled_at TIMESTAMP WITH TIME ZONE,
    leg2_cancelled_by VARCHAR(42),
    leg2_dispute_id INTEGER
);

-- 4. escrows: Tracks on-chain escrow state
CREATE TABLE escrows (
    id SERIAL PRIMARY KEY,
    trade_id INTEGER NOT NULL REFERENCES trades(id),
    escrow_address VARCHAR(42) UNIQUE NOT NULL, -- Celo contract address
    seller_address VARCHAR(42) NOT NULL,
    buyer_address VARCHAR(42) NOT NULL,
    arbitrator_address VARCHAR(42) NOT NULL,
    token_type VARCHAR(10) NOT NULL DEFAULT 'USDC',
    amount DECIMAL(15,6) NOT NULL CHECK (amount <= 100.0),
    state VARCHAR(20) NOT NULL CHECK (state IN ('CREATED', 'FUNDED', 'RELEASED', 'CANCELLED', 'DISPUTED', 'RESOLVED')),
    sequential BOOLEAN NOT NULL,
    sequential_escrow_address VARCHAR(42),
    fiat_paid BOOLEAN NOT NULL DEFAULT FALSE,
    counter INTEGER NOT NULL DEFAULT 0,
    deposit_deadline TIMESTAMP WITH TIME ZONE,
    fiat_deadline TIMESTAMP WITH TIME ZONE,
    dispute_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. disputes: Tracks dispute lifecycle
CREATE TABLE disputes (
    id SERIAL PRIMARY KEY,
    trade_id INTEGER NOT NULL REFERENCES trades(id),
    escrow_id INTEGER NOT NULL REFERENCES escrows(id),
    initiator_address VARCHAR(42) NOT NULL,
    bond_amount DECIMAL(15,6) NOT NULL CHECK (bond_amount > 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('OPENED', 'RESPONDED', 'RESOLVED', 'DEFAULTED')),
    initiated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    winner_address VARCHAR(42),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. dispute_evidence: Stores evidence metadata
CREATE TABLE dispute_evidence (
    id SERIAL PRIMARY KEY,
    dispute_id INTEGER NOT NULL REFERENCES disputes(id),
    escrow_id INTEGER NOT NULL REFERENCES escrows(id),
    trade_id INTEGER NOT NULL REFERENCES trades(id),
    submitter_address VARCHAR(42) NOT NULL,
    submission_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    evidence_text TEXT NOT NULL CHECK (LENGTH(evidence_text) <= 1000),
    pdf_s3_path TEXT NOT NULL,
    evidence_hash VARCHAR(64) NOT NULL,
    is_initial_submission BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. dispute_resolutions: Logs arbitration outcomes
CREATE TABLE dispute_resolutions (
    id SERIAL PRIMARY KEY,
    dispute_id INTEGER NOT NULL REFERENCES disputes(id),
    escrow_id INTEGER NOT NULL REFERENCES escrows(id),
    arbitrator_address VARCHAR(42) NOT NULL,
    resolution_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decision BOOLEAN NOT NULL, -- true: buyer wins, false: seller wins
    decision_explanation TEXT NOT NULL CHECK (LENGTH(decision_explanation) <= 2000),
    decision_hash VARCHAR(64) NOT NULL,
    winner_address VARCHAR(42) NOT NULL,
    funds_destination VARCHAR(42) NOT NULL,
    bond_allocation VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Foreign key constraints
ALTER TABLE trades
    ADD CONSTRAINT fk_leg1_dispute FOREIGN KEY (leg1_dispute_id) REFERENCES disputes(id),
    ADD CONSTRAINT fk_leg2_dispute FOREIGN KEY (leg2_dispute_id) REFERENCES disputes(id);

ALTER TABLE escrows
    ADD CONSTRAINT fk_dispute FOREIGN KEY (dispute_id) REFERENCES disputes(id);

-- Indexes for performance
CREATE INDEX idx_accounts_wallet_address ON accounts(wallet_address);
CREATE INDEX idx_offers_creator_account_id ON offers(creator_account_id);
CREATE INDEX idx_trades_overall_status ON trades(overall_status);
CREATE INDEX idx_trades_leg1_escrow_address ON trades(leg1_escrow_address);
CREATE INDEX idx_trades_leg2_escrow_address ON trades(leg2_escrow_address);
CREATE INDEX idx_escrows_trade_id ON escrows(trade_id);
CREATE INDEX idx_escrows_escrow_address ON escrows(escrow_address);
CREATE INDEX idx_escrows_state ON escrows(state);
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