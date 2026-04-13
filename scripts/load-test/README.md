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

## Trend tracking

Future work: write summary JSON to `perf/last-run.json`, commit a baseline,
have CI fail when a PR regresses p99 by more than 10%.
