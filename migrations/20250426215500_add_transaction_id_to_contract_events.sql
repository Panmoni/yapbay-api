-- Add transaction_id foreign key to contract_events

ALTER TABLE contract_events
  ADD COLUMN transaction_id BIGINT;

-- Backfill existing rows by matching on transaction_hash
UPDATE contract_events ce
SET transaction_id = tx.id
FROM transactions tx
WHERE ce.transaction_hash = tx.transaction_hash;

-- Enforce referential integrity
ALTER TABLE contract_events
  ADD CONSTRAINT fk_contract_events_transaction_id
  FOREIGN KEY (transaction_id)
  REFERENCES transactions(id);
