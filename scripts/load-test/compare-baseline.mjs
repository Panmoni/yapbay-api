#!/usr/bin/env node
// Compare a fresh k6 summary against the committed perf/baseline.json.
// Exits non-zero if p99 http_req_duration regresses by more than the
// threshold (default 20%, configurable via PERF_REGRESSION_THRESHOLD_PCT).
// A looser default than 10% because CI runners are noisy; tighten once
// runs are consistently stable.
//
// Usage:
//   node scripts/load-test/compare-baseline.mjs <current-summary.json> <baseline.json>

import { readFileSync } from 'node:fs';

const [, , currentPath, baselinePath] = process.argv;
if (!(currentPath && baselinePath)) {
  console.error('Usage: compare-baseline.mjs <current-summary.json> <baseline.json>');
  process.exit(2);
}

const THRESHOLD_PCT = Number(process.env.PERF_REGRESSION_THRESHOLD_PCT ?? 20);

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`[perf] failed to read ${label} (${path}): ${err.message}`);
    process.exit(2);
  }
}

const current = readJson(currentPath, 'current-summary');
const baseline = readJson(baselinePath, 'baseline');

const metrics = current.metrics ?? {};
const source =
  metrics['http_req_duration{scenario:sustained}']?.values ?? metrics.http_req_duration?.values;
if (!source) {
  console.error('current summary does not contain http_req_duration metrics');
  process.exit(2);
}

const currentP99 = source['p(99)'] ?? source.p99;
const baselineP99 = baseline?.http_req_duration_ms?.p99;
if (typeof currentP99 !== 'number' || typeof baselineP99 !== 'number') {
  console.error('could not extract p99 from one or both inputs');
  process.exit(2);
}

// Baseline of 0 means "not yet established"; skip the comparison rather
// than failing the build on the initial run. But a zero baseline is only
// valid for a bounded window — after the `_stale_after` date in the
// baseline file elapses, force a failure so the regression gate stops
// being a placebo.
if (baselineP99 === 0) {
  const staleAfter = baseline._stale_after;
  if (staleAfter && new Date() > new Date(staleAfter)) {
    console.error(
      `[perf] baseline is still zero past ${staleAfter} — the regression check has been a no-op. ` +
        'Refresh the baseline (scripts/load-test/refresh-baseline.mjs) or extend _stale_after with a reason.',
    );
    process.exit(1);
  }
  console.log('[perf] baseline not yet established (p99 = 0); skipping regression check.');
  console.log(`[perf] current p99: ${currentP99.toFixed(2)} ms`);
  process.exit(0);
}

const deltaPct = ((currentP99 - baselineP99) / baselineP99) * 100;
const fmt = (n) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));

console.log(`[perf] baseline p99: ${baselineP99.toFixed(2)} ms`);
console.log(`[perf] current  p99: ${currentP99.toFixed(2)} ms (${fmt(deltaPct)}%)`);
console.log(`[perf] threshold: ${THRESHOLD_PCT}%`);

if (deltaPct > THRESHOLD_PCT) {
  console.error(
    `[perf] REGRESSION: p99 grew ${deltaPct.toFixed(2)}% (>${THRESHOLD_PCT}%). ` +
      'Investigate before shipping; if the regression is intentional, refresh the baseline ' +
      '(scripts/load-test/refresh-baseline.mjs) in a separate commit with a reason in the message.',
  );
  process.exit(1);
}
console.log('[perf] OK');
