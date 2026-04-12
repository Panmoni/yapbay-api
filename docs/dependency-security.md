# Dependency Security

Four layers of defense against vulnerable dependencies, cheapest feedback first.

## 1. Pre-push hook (local, instant)

[scripts/git-hooks/pre-push](../scripts/git-hooks/pre-push) runs three gates
before every `git push`:

1. Shellcheck on all shell scripts (`yarn lint:shell`)
2. Amount coercion check (`scripts/check-amount-coercion.sh`) — blocks
   `Number() / parseFloat() / parseInt()` applied to financial amount fields
   in `src/routes`, `src/schemas`, `src/middleware`
3. `yarn audit --level moderate` — blocks the push if the dep tree has any
   moderate+ severity vulnerabilities

Install once per clone:

```bash
yarn hooks:install
```

Bypass (sparingly): `git push --no-verify`

## 2. GitHub Actions CI (per-push / per-PR / daily)

[.github/workflows/audit.yml](../.github/workflows/audit.yml) runs
`yarn audit` and (conditionally) `npm audit` on:

- every push to `main`
- every pull request
- a daily cron (06:00 UTC) — catches newly-disclosed CVEs against existing deps
- manual `workflow_dispatch`

**On failure**, the workflow:

1. Auto-creates the `security` label (idempotent — ignores 422).
2. Opens a GitHub issue titled `[security] Dependency audit failed on <ref>`.
   If an open issue with the same title already exists, comments on it
   instead (no duplicates).
3. GitHub's notification system emails the repo owner at the account's
   configured notification address (currently `me@georgedonnelly.com`).

**Optional SMTP email** as a belt-and-braces delivery path: set these secrets
and the workflow will also send a direct email to `me@georgedonnelly.com`:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`

The SMTP step skips silently when `SMTP_HOST` is unset (via job-level
`HAS_SMTP` env guard).

**npm audit caveat:** the workflow skips `npm audit` when `package-lock.json`
is absent (we consolidated on yarn, so it usually is). A stray
`package-lock.json` will re-enable the npm check.

## 3. Scheduled local audit (tucker, weekly)

[scripts/security/audit-notify.sh](../scripts/security/audit-notify.sh) runs
on a systemd timer on tucker. Catches the case where a new advisory drops
against existing deps even when nobody is pushing code.

**Install on tucker:**

```bash
mkdir -p ~/.config/systemd/user
cp scripts/security/yapbay-api-audit.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now yapbay-api-audit.timer
systemctl --user list-timers yapbay-api-audit.timer
```

Schedule: Mondays at 07:00 local. `Persistent=true` means a missed run (e.g.
machine was off) fires on next boot.

**Manual run for testing:**

```bash
systemctl --user start yapbay-api-audit.service
journalctl --user -u yapbay-api-audit.service -n 100
```

Requires `yarn` (via corepack in `~/.local/bin`), `gh` CLI (authenticated),
and `jq`.

## 4. Manual audit

Ad-hoc from anywhere:

```bash
bash scripts/security/audit-deps.sh
```

Or raw:

```bash
yarn audit --level moderate
npm audit --audit-level=moderate  # only works if package-lock.json exists
```

## Why both yarn and npm?

The project has `yarn.lock` as the canonical lockfile (deleted
`package-lock.json` to consolidate). Both package managers have their own
audit databases and lockfile formats; historically they found different
vulnerabilities in the same tree.

Pinned patches live in two places:

- `resolutions` in `package.json` — honored by yarn (primary)
- `overrides` in `package.json` — honored by npm (safety net for anyone who
  accidentally runs `npm install`)

## Responding to an audit failure

1. Read the advisory linked in the issue body.
2. Check exploitability in this project (is the vulnerable code reachable?
   dev-only? production?).
3. Choose:
   - **Upgrade the parent package** (cleanest): `yarn upgrade <pkg>`
   - **Pin a patched transitive**: add `"<pkg>": "<version>"` to both
     `resolutions` and `overrides` in `package.json`, then `yarn install`
   - **Accept risk** (rare): document in the issue, close with rationale

4. Verify locally:
   ```bash
   yarn audit --level moderate
   yarn build
   yarn test
   ```
5. Commit and push. CI re-runs the audit and closes the loop.

## Financial amount coercion guard

Related check: [scripts/check-amount-coercion.sh](../scripts/check-amount-coercion.sh)
blocks `Number() / parseFloat() / parseInt()` from being applied to identifiers
containing `amount` in route, schema, and middleware code. USDC amounts must
stay as decimal strings end-to-end (see [api-ref.md](api-ref.md) for rationale).
Runs in the pre-push hook.
