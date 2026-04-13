# Runbook: Solana / Celo RPC degraded

## Signal

- Alert: `yapbay_circuit_breaker_state{name=~"solana-rpc:.*"} == 2` (open).
- Listener health degrading: `/health/ready` shows
  `listener: { ok: false }`.
- Escrow-state-related requests returning 503 with `Retry-After`.

## Diagnose

1. Which breakers are open:
   ```bash
   curl -sf -H "Authorization: Bearer $METRICS_AUTH_TOKEN" \
     "$API_HOST/metrics" | grep yapbay_circuit_breaker_state
   ```
2. RPC endpoint responsiveness:
   ```bash
   curl -sf "$SOLANA_RPC_URL_DEVNET" \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}'
   ```
3. Provider status page (Helius / Triton / Alchemy / etc.). Record a link
   in the incident ticket.
4. Recent listener logs for timeouts / rate limits:
   ```bash
   journalctl --user -u yapbay-api.service -n 500 | grep -Ei 'rpc|timeout|429|503'
   ```

## Mitigate

- **Primary RPC down, backup configured**: switch env var:
  ```bash
  ssh $API_HOST "systemctl --user set-environment SOLANA_RPC_URL_DEVNET=$BACKUP_URL && \
    systemctl --user restart yapbay-api.service"
  ```
  The circuit breaker closes automatically once the new endpoint succeeds
  for `resetTimeout` (30 s default).
- **Rate limit hit**: temporarily reduce listener poll frequency /
  batch size; coordinate with provider on rate limit increase.
- **All RPC paths down**: degrade gracefully — mutating endpoints will
  continue to 503 until RPC recovers. Surface a status-page notice to users.

## Recover

- Watch breaker metric flip from `2 (open)` → `1 (halfOpen)` → `0 (closed)`.
- Watch listener health flip back to healthy on `/health/ready`.
- Reconcile any escrow rows that may have missed events during the
  outage — see [escrow-recovery.md](escrow-recovery.md).

## Post-incident

- Add the failure mode to the monitoring dashboard (if novel).
- If the outage spanned > 15 min, re-run reconciliation to catch any
  events dropped during the outage.
- Review breaker thresholds — was the breaker fast enough to avoid
  cascading failure? Values in
  [src/utils/circuitBreaker.ts](../../src/utils/circuitBreaker.ts).
