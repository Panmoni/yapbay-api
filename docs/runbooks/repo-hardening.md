# Runbook: repo + GitHub settings hardening

This runbook documents the one-time repo-owner actions that can't be
automated from code. Run once per repo (or after settings drift).

## Signal

- New repo, or
- Security review flagged unprotected `main`, or
- A force push or unsigned commit landed without review.

## Diagnose

1. Visit `github.com/<owner>/<repo>/settings/branches`.
2. Confirm a rule exists for `main`. If not, jump to **Mitigate**.
3. For the `main` rule, verify:
   - Required status checks: `lint-and-typecheck`, `tests-fast`,
     `tests-integration`, `security-scan` (semgrep + gitleaks job names).
   - Require signed commits: **on**.
   - Include administrators: **on**.
   - Restrict force pushes: **on**.
   - Require conversation resolution before merging: **on**.

## Mitigate / set up

### 1. Branch protection on `main`

Settings → **Branches** → Add classic branch protection rule (or a ruleset
if using Repository Rulesets):

- Branch name pattern: `main`
- ☑ Require status checks to pass before merging
  - ☑ Require branches to be up to date
  - Add checks (by name as reported by the workflow runs):
    - `lint-and-typecheck`
    - `tests-fast`
    - `tests-integration`
    - `Semgrep SAST`
    - `gitleaks secret scan`
  - Optional (nightly only): `image-scan.yml`, `mutation-test.yml`,
    `perf-regression.yml` — **do NOT** mark required; they run on
    schedule, not per-PR.
- ☑ Require signed commits
- ☑ Require conversation resolution before merging
- ☑ Do not allow bypassing the above settings
- ☑ Restrict who can push to matching branches (add bot users for
  semantic-release and the deploy workflow; exclude everyone else)
- ☑ Allow force pushes: **off**
- ☑ Allow deletions: **off**

### 2. GPG key for signed commits

**Human contributors** (interactive):

```bash
gpg --full-generate-key          # Ed25519 or RSA 4096
gpg --list-secret-keys --keyid-format=long
gpg --armor --export <KEYID>     # upload to github.com/settings/keys
git config --global user.signingkey <KEYID>
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

**Release bot / CI** (non-interactive, scriptable):

```bash
cat > /tmp/gpg-batch.conf <<EOF
%no-protection
Key-Type: EDDSA
Key-Curve: ed25519
Name-Real: YapBay Release Bot
Name-Email: release-bot@yapbay.com
Expire-Date: 1y
%commit
EOF
gpg --batch --generate-key /tmp/gpg-batch.conf
KEYID=$(gpg --list-secret-keys --keyid-format=long --with-colons | awk -F: '/^sec:/ {print $5; exit}')
gpg --armor --export-secret-keys "$KEYID"   # add as RELEASE_GPG_PRIVATE_KEY secret
gpg --armor --export "$KEYID"                # add to github.com/settings/keys for the bot account
```

Wire the private key into the release workflow via `crazy-max/ghaction-import-gpg`
(or equivalent) with `RELEASE_GPG_PRIVATE_KEY` secret. Configure
semantic-release's `@semantic-release/git` plugin with the signing key id.
Rotate annually or on any suspected compromise.

### 3. Workflow permissions (GitHub Actions)

Settings → **Actions** → **General** → Workflow permissions:

- Default `GITHUB_TOKEN` permissions: **Read repository contents and
  packages permissions** (minimum).
- Every workflow already declares explicit `permissions:` blocks —
  confirm by spot-checking `.github/workflows/*.yml`.
- Allow GitHub Actions to create and approve pull requests: **off**.

### 4. Dependabot

Settings → **Code security and analysis**:

- ☑ Dependabot alerts
- ☑ Dependabot security updates
- ☑ Dependabot version updates — creates a `.github/dependabot.yml`.
  Recommended configuration: weekly cadence, grouped by ecosystem,
  `labels: [security, dependencies]`, `reviewers: [@<owner>]`.

### 5. Secret scanning + push protection

Settings → **Code security and analysis**:

- ☑ Secret scanning
- ☑ Push protection

These layer on top of the gitleaks CI check — push protection catches
a leak before the commit even reaches `origin`.

## Recover

- Pick a trivial PR, attempt to push an unsigned commit. Confirm
  GitHub rejects it.
- Push a commit that fails a required check. Confirm the merge button
  is greyed out with "Required statuses must pass".
- Attempt `git push --force-with-lease origin main`. Confirm rejected.

## Post-incident

- Document the date of the last settings audit in
  `docs/runbooks/repo-hardening.md` (this file). Drift check quarterly.
- If bypassing a check was required (e.g., incident response), add a
  ticket to re-tighten the bypassed setting.

## Automation notes

GitHub settings can be declared in a `.github/settings.yml` file via the
[repository-settings GitHub App](https://github.com/apps/settings), but
that's a third-party app — evaluate the trust boundary before adopting.
