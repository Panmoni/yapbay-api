# Dependency security tooling

Three layers of defense against vulnerable dependencies:

## 1. Pre-push hook (local)

Runs `yarn audit --level moderate` before every `git push`. Blocks pushes if
moderate or higher vulnerabilities are present.

Install once:
```bash
yarn hooks:install
```

Bypass (sparingly): `git push --no-verify`

## 2. GitHub Actions (CI)

[.github/workflows/audit.yml](../../.github/workflows/audit.yml) runs `yarn audit`
and `npm audit` on:
- every push to `main`
- every pull request
- a daily cron (06:00 UTC)

On failure, opens (or comments on) a GitHub issue labeled `security`. GitHub's
notification system emails the configured address for the account owner.

## 3. Scheduled local audit (tucker)

Systemd timer + service that runs `audit-notify.sh` weekly. Catches CVEs
disclosed against existing deps even when nobody is pushing new code.

### Install on tucker

```bash
# 1. Copy unit files to user systemd
mkdir -p ~/.config/systemd/user
cp scripts/security/yapbay-api-audit.{service,timer} ~/.config/systemd/user/

# 2. Enable + start the timer
systemctl --user daemon-reload
systemctl --user enable --now yapbay-api-audit.timer

# 3. Verify
systemctl --user list-timers yapbay-api-audit.timer
```

### One-off run for testing

```bash
systemctl --user start yapbay-api-audit.service
journalctl --user -u yapbay-api-audit.service -n 100
```

### Requires
- `yarn` (corepack-installed into `~/.local/bin`)
- `gh` CLI authenticated: `gh auth status`
- `jq` for JSON parsing

## Manual audit

Run ad-hoc with existing script:
```bash
bash scripts/security/audit-deps.sh
```
