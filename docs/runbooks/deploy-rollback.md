# Runbook: deploy rollback

## Signal

- Post-deploy error rate spike.
- `/health/ready` returning 503.
- Migration failure during rollout.

## Diagnose

1. Current deployed SHA:
   ```bash
   ssh $API_HOST "cat /tmp/git_commit_hash || echo unknown"
   ```
2. Previous deploy SHA (from CI `deploy.yml` run log or GitHub
   Deployments tab).
3. Did a migration apply?
   ```bash
   pnpm migrate:status
   ```
   (Run from a checkout of the *new* commit to see what it expected.)

## Mitigate

### Rollback strategy A — code only (no migration applied)

1. On the deploy machine:
   ```bash
   cd /path/to/yapbay-api
   git checkout <previous-sha>
   pnpm install --frozen-lockfile
   pnpm build
   systemctl --user restart yapbay-api.service
   ```
2. Verify `/health/ready` returns 200 and error rate drops.

### Rollback strategy B — code + migration

If a migration was applied and the new code is wedged on it:

1. **Prefer forward-fix.** Most migrations are backward-compatible by
   design (add column NULL, don't drop). Ship a hotfix release rather
   than rolling back the schema.
2. If rollback is unavoidable:
   ```bash
   pnpm migrate:rollback -- <filename>
   git checkout <previous-sha>
   pnpm install --frozen-lockfile && pnpm build
   systemctl --user restart yapbay-api.service
   ```
3. Verify DB state matches the previous code's expectations:
   ```bash
   pnpm db:health:verbose
   ```

## Recover

- `/health/ready` → 200
- Metrics: HTTP 5xx rate back to baseline
- User-facing functionality: spot-check `/accounts/me`, `/trades/*`, escrow
  creation

## Post-incident

- Document the failure mode in the incident log.
- If the deploy pipeline didn't catch it, add a test (unit, integration,
  or smoke) that would have.
- Consider adding a canary deploy step to deploy.yml before full rollout.
- Review whether the migration should have been split into non-breaking
  steps (see ADR 0005 for an example of a multi-migration strategy).
