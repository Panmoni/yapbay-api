# Runbooks

Operational playbooks for the on-call engineer. Each runbook assumes you
have shell access to the API host and psql access to the primary DB.

## Index

- [escrow-recovery.md](escrow-recovery.md) — escrow stuck between states
- [db-health.md](db-health.md) — pool exhaustion, slow queries, connection storms
- [rpc-failover.md](rpc-failover.md) — Solana / Celo RPC is degraded
- [deploy-rollback.md](deploy-rollback.md) — revert a bad deploy
- [reconciliation-breach.md](reconciliation-breach.md) — escrow balance mismatch alert

## Conventions

- Commands use absolute paths where possible.
- `$API_HOST` refers to the production API host (tucker).
- Each runbook has **Signal**, **Diagnose**, **Mitigate**, **Recover**,
  **Post-incident** sections. Skip what doesn't apply — don't invent steps.
- When in doubt, **preserve state**. Dump evidence before restarting anything.
