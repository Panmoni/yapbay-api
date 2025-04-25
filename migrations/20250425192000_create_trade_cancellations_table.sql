-- Migration: create trade_cancellations table for audit trail of auto-cancels

CREATE TABLE trade_cancellations (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  actor VARCHAR(50) NOT NULL,
  deadline_field VARCHAR(64) NOT NULL,
  cancelled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Optionally index by trade_id
CREATE INDEX idx_trade_cancellations_trade_id ON trade_cancellations(trade_id);
