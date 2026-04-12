// Prometheus metrics exposed at GET /metrics.
//
// Default Node process + GC metrics are registered automatically. Application
// metrics below cover the financial hot path: HTTP latency, DB pool, circuit
// breakers, idempotency cache hits, escrow state transitions, RPC call times.
//
// The /metrics endpoint is guarded: in production it requires the
// METRICS_AUTH_TOKEN env var in the `Authorization: Bearer <token>` header.
// In dev it's open for local scraping.

import type { NextFunction, Request, Response } from 'express';
import { Counter, collectDefaultMetrics, Gauge, Histogram, register } from 'prom-client';
import { getBreakerStates } from './utils/circuitBreaker';

collectDefaultMetrics({ prefix: 'yapbay_' });

export const httpRequestDuration = new Histogram({
  name: 'yapbay_http_request_duration_seconds',
  help: 'HTTP request duration in seconds, labeled by route and status class.',
  labelNames: ['method', 'route', 'status_class'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const blockchainRpcDuration = new Histogram({
  name: 'yapbay_blockchain_rpc_duration_seconds',
  help: 'Blockchain RPC call duration, labeled by chain and method.',
  labelNames: ['chain', 'method', 'outcome'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

export const idempotencyCacheHits = new Counter({
  name: 'yapbay_idempotency_cache_hits_total',
  help: 'Idempotency replays served from cache.',
  labelNames: ['outcome'],
});

export const escrowStateGauge = new Gauge({
  name: 'yapbay_escrow_state_total',
  help: 'Count of escrows currently in each state (sampled).',
  labelNames: ['state'],
});

export const dbPoolGauge = new Gauge({
  name: 'yapbay_db_pool_connections',
  help: 'pg pool connection counts.',
  labelNames: ['kind'],
});

const circuitBreakerGauge = new Gauge({
  name: 'yapbay_circuit_breaker_state',
  help: 'Circuit breaker state per service (0=closed, 1=half-open, 2=open).',
  labelNames: ['name'],
  collect() {
    for (const snapshot of getBreakerStates()) {
      const v = snapshot.state === 'closed' ? 0 : snapshot.state === 'halfOpen' ? 1 : 2;
      this.labels(snapshot.name).set(v);
    }
  },
});
// Reference to keep the collector alive in tree-shaken builds.
export const _circuitBreakerGauge = circuitBreakerGauge;

/** Express middleware that records duration of every request. Mount early. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  const done = () => {
    // Only use the matched route template. Never fall back to req.path (raw
    // URL including IDs) — that blows Prometheus cardinality over weeks.
    const route = req.route?.path ?? (req.baseUrl || 'unmatched');
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    end({ method: req.method, route, status_class: statusClass });
  };
  res.on('finish', done);
  res.on('close', () => {
    if (!res.writableEnded) {
      // Client disconnected before the response finished. Record anyway so
      // p99 reflects real client experience.
      done();
    }
  });
  next();
}

/**
 * Guarded /metrics handler. In production the METRICS_AUTH_TOKEN env var is
 * **required**: if unset, every request is rejected 503 so a deploy that
 * forgot the var cannot silently expose metrics publicly (fail closed).
 */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    const token = process.env.METRICS_AUTH_TOKEN;
    if (!token) {
      res.status(503).json({ error: 'metrics_not_configured' });
      return;
    }
    const header = req.header('authorization') ?? '';
    if (header !== `Bearer ${token}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  }
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
}
