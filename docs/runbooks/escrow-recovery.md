# Runbook: escrow stuck between states

## Signal

- Alert: escrow older than X hours still in `IN_PROGRESS` / `FUNDED` with no
  state transition.
- User report: funds locked, no release or cancellation.
- Reconciliation job mismatch (see [reconciliation-breach.md](reconciliation-breach.md)).

## Diagnose

1. Find the stuck escrow:
   ```sql
   SELECT id, onchain_escrow_id, state, network_id, current_balance, created_at, updated_at
   FROM escrows
   WHERE id = <escrow_id>;
   ```
2. Check the transaction timeline for that escrow:
   ```sql
   SELECT id, type, status, transaction_hash, created_at
   FROM transactions
   WHERE related_escrow_db_id = <escrow_id>
   ORDER BY created_at;
   ```
3. Check for missed events — is the listener healthy?
   ```bash
   curl -sf "$API_HOST/health/ready" | jq .checks.listener
   journalctl --user -u yapbay-api.service -n 500 | grep -i "solana event"
   ```
4. Compare against on-chain state. For Solana:
   ```bash
   # Replace with the actual onchain_escrow_id from step 1
   solana account <onchain_escrow_id> --url devnet
   ```

## Mitigate

- **If the listener is down**: restart it (Mitigate section of
  [rpc-failover.md](rpc-failover.md)).
- **If the listener missed an event**: trigger a re-sync from the last
  confirmed slot. Look for the `backfillSolanaEvents` helper or invoke the
  listener's replay entry point. Capture the slot range in the incident notes.
- **If the on-chain state is terminal but the DB still shows in-progress**:
  don't manually `UPDATE escrows SET state = ...`. Migration 0037's
  immutability trigger will reject the UPDATE anyway. Instead, use the
  admin state-transition endpoint (if applicable) OR:
  ```sql
  BEGIN;
  SET LOCAL session_replication_role = 'replica';
  UPDATE escrows SET state = '<correct state>', completed_at = NOW()
    WHERE id = <escrow_id>;
  -- verify ONE row affected
  COMMIT;
  ```
  Document the reason in the incident log. `session_replication_role` bypass
  requires superuser or explicit grant — do not grant casually.

## Recover

- Re-run the reconciliation job:
  ```bash
  ssh $API_HOST "cd /opt/yapbay-api && pnpm exec ts-node -e \
    \"require('./src/jobs/reconcileEscrowBalances').reconcileEscrowBalances(fetcher)\""
  ```
- Notify the affected users if funds were temporarily unavailable.

## Post-incident

- Was this a listener gap? File a ticket for backfill automation.
- Was this a chain reorg? Document the slot range and consider tightening
  the listener's confirmation depth.
- If a manual override was used, confirm migration 0037 is still in place
  and the bypass wasn't left enabled.
