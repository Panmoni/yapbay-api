-- Migration: Create transactions table and related types
-- Timestamp: 20250422154502

BEGIN; -- Start transaction

-- Create ENUM types if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_status') THEN
        CREATE TYPE transaction_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
        CREATE TYPE transaction_type AS ENUM (
            'CREATE_ESCROW',
            'FUND_ESCROW',
            'RELEASE_ESCROW',
            'CANCEL_ESCROW',
            'MARK_FIAT_PAID',
            'OPEN_DISPUTE',
            'RESPOND_DISPUTE',
            'RESOLVE_DISPUTE',
            'OTHER'
        );
    END IF;
END$$;

-- Create the transactions table
CREATE TABLE transactions (
    id BIGSERIAL PRIMARY KEY,
    transaction_hash VARCHAR(66) UNIQUE NOT NULL, -- 0x + 64 hex chars
    status transaction_status NOT NULL DEFAULT 'PENDING',
    type transaction_type NOT NULL,
    block_number BIGINT,
    sender_address VARCHAR(42), -- Address initiating the tx
    receiver_or_contract_address VARCHAR(42), -- Address receiving or contract interacted with
    gas_used DECIMAL(20, 0), -- Gas units used
    error_message TEXT, -- Store error if status is 'FAILED'
    related_trade_id INTEGER REFERENCES trades(id) ON DELETE SET NULL, -- Optional link
    related_escrow_db_id INTEGER REFERENCES escrows(id) ON DELETE SET NULL, -- Optional link to our DB escrow ID
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_trade_id ON transactions(related_trade_id);
CREATE INDEX idx_transactions_escrow_db_id ON transactions(related_escrow_db_id);
CREATE INDEX idx_transactions_hash ON transactions(transaction_hash);

-- Commit changes
COMMIT;