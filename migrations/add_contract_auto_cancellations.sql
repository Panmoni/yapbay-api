-- Migration: Add contract_auto_cancellations table
-- This table tracks automatic cancellations performed by the monitoring service

CREATE TABLE IF NOT EXISTS contract_auto_cancellations (
    id SERIAL PRIMARY KEY,
    escrow_id INTEGER NOT NULL,
    transaction_hash VARCHAR(66),
    gas_used INTEGER,
    gas_price BIGINT,
    status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'PENDING')),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient querying by escrow_id
CREATE INDEX IF NOT EXISTS idx_contract_auto_cancellations_escrow_id 
    ON contract_auto_cancellations(escrow_id);

-- Index for querying by status
CREATE INDEX IF NOT EXISTS idx_contract_auto_cancellations_status 
    ON contract_auto_cancellations(status);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_contract_auto_cancellations_created_at 
    ON contract_auto_cancellations(created_at);

-- Index for transaction hash lookups
CREATE INDEX IF NOT EXISTS idx_contract_auto_cancellations_tx_hash 
    ON contract_auto_cancellations(transaction_hash);

COMMENT ON TABLE contract_auto_cancellations IS 'Tracks automatic escrow cancellations performed by the monitoring service';
COMMENT ON COLUMN contract_auto_cancellations.escrow_id IS 'The blockchain escrow ID that was cancelled';
COMMENT ON COLUMN contract_auto_cancellations.transaction_hash IS 'The blockchain transaction hash of the cancellation';
COMMENT ON COLUMN contract_auto_cancellations.gas_used IS 'Amount of gas used for the transaction';
COMMENT ON COLUMN contract_auto_cancellations.gas_price IS 'Gas price in wei for the transaction';
COMMENT ON COLUMN contract_auto_cancellations.status IS 'Status of the cancellation attempt: SUCCESS, FAILED, or PENDING';
COMMENT ON COLUMN contract_auto_cancellations.error_message IS 'Error message if the cancellation failed';