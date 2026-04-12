-- Idempotency key storage for replay-safe financial mutations.
--
-- Clients send `Idempotency-Key` on POST/PUT requests that create or mutate
-- escrow/trade/transaction state. The middleware caches the response body and
-- status for 24h, so retries (network timeouts, load balancer failovers,
-- client-side retry loops) never double-execute a ledger write.
--
-- request_hash is a sha256 over the route + normalized JSON body. A key
-- replayed with a different body returns HTTP 409 rather than serving the
-- cached response — catches client bugs that reuse a key across operations.

CREATE TABLE IF NOT EXISTS idempotency_records (
  key TEXT PRIMARY KEY,
  user_sub TEXT,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Expiry sweep uses this index. Run `DELETE FROM idempotency_records WHERE expires_at < NOW()`
-- on a cron (hourly).
CREATE INDEX IF NOT EXISTS idx_idempotency_records_expires
  ON idempotency_records (expires_at);

-- Optional per-user lookup for admin/audit.
CREATE INDEX IF NOT EXISTS idx_idempotency_records_user_sub
  ON idempotency_records (user_sub)
  WHERE user_sub IS NOT NULL;

-- DOWN
DROP INDEX IF EXISTS idx_idempotency_records_user_sub;
DROP INDEX IF EXISTS idx_idempotency_records_expires;
DROP TABLE IF EXISTS idempotency_records;
