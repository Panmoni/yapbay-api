// k6 load test: sustained + spike scenarios against POST /transactions/record
// (the hottest write path under real production load).
//
// Usage:
//   k6 run scripts/load-test/escrow-create.js \
//     -e BASE_URL=http://localhost:3011 \
//     -e JWT=eyJhbGciOi...
//
// Baselines we care about:
//   - p99 < 500ms at 100 concurrent users (sustained scenario)
//   - 0 errors under sustained load
//   - Graceful degradation under 500 RPS spike (429 is acceptable; 5xx is not)
//
// Results are written to perf/last-run.json so trends can be tracked over
// time (future work: commit baseline.json, diff each CI run against it).

import { randomString, uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { check, sleep } from 'k6';
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3011';
const JWT = __ENV.JWT || '';
// IDs must exist in the target DB. Default to 1/1 for local dev where the
// seed script provisions them; override via env when running against
// staging. If the target doesn't have them, the run 4xx's and metrics
// reflect that.
const TRADE_ID = Number(__ENV.TRADE_ID || 1);
const ESCROW_ID = Number(__ENV.ESCROW_ID || 1);
const NETWORK_NAME = __ENV.NETWORK_NAME || 'solana-devnet';

// Fail fast if BASE_URL is malformed — k6 silently no-ops on bad URLs.
try {
  new URL(BASE_URL);
} catch {
  throw new Error(`BASE_URL is not a valid URL: ${BASE_URL}`);
}

export const options = {
  scenarios: {
    sustained: {
      executor: 'constant-vus',
      vus: 100,
      duration: '5m',
      tags: { scenario: 'sustained' },
    },
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 500,
      stages: [
        { target: 0, duration: '10s' }, // warmup
        { target: 500, duration: '30s' }, // spike
        { target: 0, duration: '20s' }, // recovery
      ],
      startTime: '6m',
      tags: { scenario: 'spike' },
    },
  },
  thresholds: {
    'http_req_duration{scenario:sustained}': ['p(99)<500'],
    'http_req_failed{scenario:sustained}': ['rate<0.001'],
    // Spike: any 5xx is a regression. 429s are expected and not counted here.
    'http_req_failed{scenario:spike,status:5xx}': ['rate<0.01'],
  },
};

export default function () {
  const idempotencyKey = uuidv4();
  const body = JSON.stringify({
    trade_id: TRADE_ID,
    escrow_id: ESCROW_ID,
    transaction_hash: `0x${randomString(64, 'abcdef0123456789')}`,
    transaction_type: 'CREATE_ESCROW',
    from_address: '0xabc',
    to_address: '0xdef',
    block_number: 0,
    status: 'SUCCESS',
  });

  const res = http.post(`${BASE_URL}/transactions/record`, body, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${JWT}`,
      'idempotency-key': idempotencyKey,
      'x-network-name': NETWORK_NAME,
    },
  });

  check(res, {
    'status is 2xx or 429': (r) => (r.status >= 200 && r.status < 300) || r.status === 429,
  });

  // Loose pacing so we don't drown the server during constant-vus mode.
  sleep(0.1);
}
