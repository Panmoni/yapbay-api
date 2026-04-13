# Runbook: escrow balance mismatch alert

## Signal

- `RECONCILIATION_WEBHOOK` fired OR log entry `reconcile: balance mismatch
  beyond tolerance` in yapbay-api journal.
- Field `reason`: `db_ahead` (DB balance > on-chain) or `onchain_ahead`
  (on-chain balance > DB).

## Diagnose

This is **high severity** — a balance mismatch means the ledger is
divergent from reality. Before acting, preserve evidence.

1. Capture the alert payload verbatim into the incident log.
2. Pull full escrow history:
   ```sql
   SELECT id, onchain_escrow_id, state, current_balance, network_id,
          created_at, updated_at
   FROM escrows
   WHERE id = <escrow_db_id>;

   SELECT id, type, status, transaction_hash, signature, block_number,
          created_at
   FROM transactions
   WHERE related_escrow_db_id = <escrow_db_id>
   ORDER BY created_at;
   ```
3. Verify on-chain balance directly (don't trust the reconciliation job's
   snapshot):
   ```bash
   # Solana example
   solana account <onchain_escrow_id> --url $SOLANA_RPC_URL_DEVNET
   ```
4. Classify:
   - **db_ahead** (DB > on-chain): likely missed a release/cancel event OR
     an unauthorized on-chain withdrawal.
   - **onchain_ahead** (DB < on-chain): likely missed a funding event OR
     unexpected on-chain deposit.

## Mitigate

**Do NOT auto-correct.** Reconciliation never writes; neither should a
first response.

1. If the delta is small (<0.01 USDC), it's almost certainly float
   rounding from a legacy code path — file a ticket, don't page.
2. If the delta is meaningful:
   - Freeze further state transitions on the affected escrow via an
     explicit admin action (route or DB + trigger bypass in a single
     transaction, logged).
   - Notify the affected user(s).
   - Escalate to on-call lead + treasury.

## Recover

Only after root cause is understood:

- **Missed event**: replay from the listener. Confirm the new DB state
  matches on-chain before lifting the freeze.
- **Unauthorized on-chain movement**: do not write to DB. Treat as a
  security incident. Rotate affected keys, review audit trail, preserve
  for forensics.
- **Legitimate unexpected funding** (rare): coordinate with treasury to
  determine the correct resolution before mutating any state.

## Post-incident

- Re-run reconciliation on demand:
  ```bash
  ssh $API_HOST "cd /opt/yapbay-api && pnpm exec ts-node -e \
    \"require('./src/jobs/reconcileEscrowBalances').reconcileEscrowBalances(fetcher)\""
  ```
- Reduce the tolerance in [src/jobs/reconcileEscrowBalances.ts](../../src/jobs/reconcileEscrowBalances.ts)
  if this escrow's mismatch was sub-threshold.
- Ask: why didn't the circuit breaker / listener health signal catch this
  earlier? File a ticket for the observability gap.
