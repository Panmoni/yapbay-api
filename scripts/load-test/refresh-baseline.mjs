#!/usr/bin/env node
// Refresh perf/baseline.json from a recent k6 summary.
//
// Usage:
//   node scripts/load-test/refresh-baseline.mjs <current-summary.json> <baseline.json>
//
// Keeps the existing _comment / _refresh_instructions / fixture / vus /
// duration_seconds fields. Updates generated_at + the percentiles + failure
// rate + iterations. Intended to be run deliberately by a human after a
// sustained improvement — never automated. Commit the diff as a separate PR
// so the regression check has something meaningful to compare against.

import { readFileSync, writeFileSync } from 'node:fs';

const [, , currentPath, baselinePath] = process.argv;
if (!(currentPath && baselinePath)) {
  console.error('Usage: refresh-baseline.mjs <current-summary.json> <baseline.json>');
  process.exit(2);
}

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
  console.error('summary does not contain http_req_duration metrics');
  process.exit(2);
}

const failedSource =
  metrics['http_req_failed{scenario:sustained}']?.values ?? metrics.http_req_failed?.values ?? {};

baseline.generated_at = new Date().toISOString();
baseline.http_req_duration_ms = {
  p50: +(source['p(50)'] ?? source.p50 ?? 0).toFixed(2),
  p90: +(source['p(90)'] ?? source.p90 ?? 0).toFixed(2),
  p95: +(source['p(95)'] ?? source.p95 ?? 0).toFixed(2),
  p99: +(source['p(99)'] ?? source.p99 ?? 0).toFixed(2),
};
baseline.http_req_failed_rate = +(failedSource.rate ?? 0).toFixed(4);
baseline.iterations = metrics.iterations?.values?.count ?? 0;

writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`[perf] wrote ${baselinePath}`);
console.log(
  '[perf] new baseline p50/p95/p99 (ms):',
  baseline.http_req_duration_ms.p50,
  baseline.http_req_duration_ms.p95,
  baseline.http_req_duration_ms.p99,
);
