# Load testing

k6 scripts for the hot financial paths. Run against a staging environment,
not production.

## Setup

```bash
# Ubuntu
sudo snap install k6

# macOS
brew install k6
```

## Scripts

| Script | What it does |
|---|---|
| [escrow-create.js](escrow-create.js) | `POST /transactions/record` — sustained (100 VUs × 5 min) + spike (0→500 RPS in 30s) |

## Running

```bash
JWT="$(curl ... | jq -r .token)"
k6 run scripts/load-test/escrow-create.js \
  -e BASE_URL=https://staging.yapbay.com \
  -e JWT="$JWT"
```

## Thresholds

| Metric | Target |
|---|---|
| `p99` (sustained) | < 500 ms |
| `error rate` (sustained) | < 0.1% |
| `5xx rate` (spike) | < 1% — 429s are expected and allowed |

## Baseline + regression check

The committed baseline lives at [`perf/baseline.json`](../../perf/baseline.json).
The `perf-regression.yml` workflow runs nightly, executes the sustained
scenario for ~30 s (shorter than the local 5-minute run so it fits the
workflow budget), and fails if p99 regresses beyond
`PERF_REGRESSION_THRESHOLD_PCT` (default 20%).

### When to refresh the baseline

Refresh it **deliberately** after a sustained, verified performance
improvement — never casually. The flow:

```bash
# Run k6 against staging / docker-compose fixture
k6 run --summary-export=perf/last-run.json scripts/load-test/escrow-create.js \
  -e BASE_URL=http://localhost:3011 -e JWT="$TOKEN" \
  -e TRADE_ID=1 -e ESCROW_ID=1 -e NETWORK_NAME=solana-devnet

# Update the baseline
node scripts/load-test/refresh-baseline.mjs perf/last-run.json perf/baseline.json

# Commit in its own PR; the message should explain *why* the baseline moved.
git add perf/baseline.json
git commit -m "perf(baseline): refresh after <reason>"
```

### Regression-check threshold

Start at 20% because shared CI runners are noisy. Tighten to 10% after a
week of stable nightly runs. Set via `PERF_REGRESSION_THRESHOLD_PCT` in
[`.github/workflows/perf-regression.yml`](../../.github/workflows/perf-regression.yml).
