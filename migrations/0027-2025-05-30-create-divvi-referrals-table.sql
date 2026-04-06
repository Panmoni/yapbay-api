-- Migration: Create divvi_referrals table
-- Created: 2025-05-30

CREATE TABLE divvi_referrals (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    chain_id INTEGER NOT NULL,
    trade_id INTEGER REFERENCES trades(id),
    submission_status INTEGER, -- 200, 400, 500 from Divvi API
    submission_response JSONB, -- Full Divvi API response
    submitted_providers_with_existing_referral JSONB, -- Array from response.data.submittedProvidersWithExistingReferral
    error_message TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_divvi_referrals_wallet_address ON divvi_referrals(wallet_address);
CREATE INDEX idx_divvi_referrals_transaction_hash ON divvi_referrals(transaction_hash);
CREATE INDEX idx_divvi_referrals_chain_id ON divvi_referrals(chain_id);
CREATE INDEX idx_divvi_referrals_submission_status ON divvi_referrals(submission_status);
CREATE INDEX idx_divvi_referrals_trade_id ON divvi_referrals(trade_id);
CREATE INDEX idx_divvi_referrals_created_at ON divvi_referrals(created_at);

-- Unique constraint to prevent duplicate submissions for same transaction
CREATE UNIQUE INDEX idx_divvi_referrals_unique_tx ON divvi_referrals(transaction_hash, chain_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_divvi_referrals_updated_at 
    BEFORE UPDATE ON divvi_referrals 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();