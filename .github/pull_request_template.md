<!--
  Thanks for the PR. Fill in the sections below so reviewers can move fast.
  Delete what doesn't apply. Required boxes must be checked before merge.
-->

## Summary

<!-- 1-3 sentences: what changed and why. Link any issue / plan / ADR. -->

## Changes

<!-- Bullet list of the concrete changes. Group by file/module if it helps. -->
-

## Risk

<!-- What's the blast radius if this is wrong? Can it be rolled back cleanly? -->

## Test plan

<!-- How did you verify this works? Commands, URLs, screenshots welcome. -->
- [ ] `pnpm lint` and `pnpm exec tsc --noEmit` pass
- [ ] `pnpm build` succeeds
- [ ] Tightly-related tests pass (list them)
- [ ] Manual verification in dev / staging (describe)

## Financial-change checklist

<!-- REQUIRED if this PR touches money paths: decimalMath, idempotency,
     migrations/, routes/transactions, routes/escrows, routes/trades,
     jobs/, or db.ts. Delete this section otherwise. -->
- [ ] Idempotency considered: mutating endpoints accept `Idempotency-Key` OR replay is intrinsically safe.
- [ ] No float arithmetic on money (Number/parseFloat/+ on `amount`/`balance`/`fee`/`price`). Use `decimalMath` from `src/utils/decimalMath.ts`.
- [ ] DB transaction boundary correct — every multi-table write is inside `withTransaction(...)`.
- [ ] Migration (if any) has a tested `-- DOWN` block and is idempotent (`IF NOT EXISTS` / `IF EXISTS`).
- [ ] Terminal-state rows remain immutable (migration 0037 trigger not bypassed).
- [ ] Observability: new code paths emit a trace span and structured log line.
- [ ] Circuit-breaker-protected if the call reaches an external RPC.
- [ ] Reconciliation impact: does this change what `reconcileEscrowBalances` compares? Update the job.

## Security checklist

- [ ] No raw `JSON.parse` on request data — use `safeJsonParse`.
- [ ] No secrets committed. `.env*` paths respected.
- [ ] User-provided fields are Zod-validated before reaching DB / services.
- [ ] SQL is parameterized — no string concatenation into `query(...)`.

## Deployment notes

<!-- Migrations to apply? Env vars added (update env.example + api-ref)?
     Feature flag? Backfill or runbook step needed? -->

## Rollback plan

<!-- How do we revert if this breaks in prod? One sentence is fine. -->
