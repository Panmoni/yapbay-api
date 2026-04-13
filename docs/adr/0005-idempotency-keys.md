# 0005 — Idempotency keys for financial mutations

**Status**: Accepted (2026-04-12)

## Context

A financial API's single worst bug is double-execution: a network retry
creates two escrows, two ledger entries, two on-chain transactions.
Without a client-provided replay-safety token, retries during server
restarts / load balancer failovers / mobile app reconnects all risk
duplicate execution.

An initial draft of the middleware (Phase 1) had several correctness bugs
— cross-user cache leak, wrong cache key, double-execution race under
concurrent identical-key requests. These were caught by the heavy-duty
review and fixed here.

## Decision

Every mutating route under `/transactions`, `/escrows`, `/trades` accepts
an optional `Idempotency-Key: <uuid-v4>` header. Middleware in
[src/middleware/idempotency.ts](../../src/middleware/idempotency.ts) provides:

- **Per-user scope.** Cache rows are keyed by `(key, user_sub)` via two
  partial unique indexes (migration 0036). One user cannot read another
  user's cached response — a critical privacy property.
- **Advisory lock serialization.** `pg_advisory_xact_lock(int, int)`
  keyed on `sha256(key || user_sub)` serializes concurrent same-key
  requests. The second request blocks until the first commits, then
  replays the cached response rather than re-executing — no double-spend.
- **Canonical body hashing.** `method + originalUrl + canonical JSON`
  (keys recursively sorted) means `:id` params participate in the key and
  body key order doesn't cause false 409 mismatches across clients.
- **2xx-only caching.** Validation errors (4xx) re-execute on retry so
  clients can correct input without rotating the key. 5xx never caches.
- **Full response capture.** `res.json`, `res.send`, and `res.end` are all
  intercepted — handlers can't accidentally bypass caching.
- **Hourly sweep.** `sweepExpiredIdempotencyRecords()` cron deletes rows
  past `expires_at` (default 24 h).

## Consequences

- Every mutating request pays one extra SELECT + INSERT, bounded by a
  primary-key index. Measured overhead in benchmarks: ~2 ms p50.
- Clients must generate a UUID v4 per logical operation and reuse it on
  retries. Docs in [docs/api-ref.md](../api-ref.md#idempotency).
- `idempotency_records` table grows ~1 row per mutation per user per day.
  At 100 req/s it's about 8.6 M rows/day; the sweep keeps it bounded.
  Partitioning is a future optimization — see Phase 1.1 remediation plan.

## Alternatives considered

- **Client-side retry idempotency.** Unreliable — doesn't survive app
  crashes or network-layer retries outside the client's control.
- **Deduplication via a unique constraint on business data (e.g. unique
  `trade_id`).** Works for some operations but not for idempotent state
  transitions where the business data is unchanged by design.
- **Redis cache instead of Postgres table.** Faster but adds a
  correctness dependency on Redis liveness. Postgres is already on the
  critical path and transactionally consistent with the mutation itself.
