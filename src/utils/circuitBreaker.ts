// Circuit breaker factory for external service calls (blockchain RPC, webhooks).
//
// Wraps any async function so cascading failures don't pin the event loop:
// - 5 failures inside a 10s rolling window -> open (reject immediately)
// - after 30s -> half-open (try one call)
// - success -> closed
//
// API:
//   const rpc = getBreaker('solana-rpc');
//   await rpc.fire(() => connection.getAccountInfo(pubkey));
//
// A registry dedupes breakers by name. The breaker itself is the long-lived
// object; each `fire(fn)` call invokes `fn` under that breaker's state
// machine. This avoids the footgun of capturing a single first-call closure.
//
// Metrics (src/metrics.ts) reads `getBreakerStates()` for the
// `circuit_breaker_state` gauge.

import CircuitBreaker from 'opossum';
import { logger } from '../logger';

export type BreakerState = 'closed' | 'open' | 'halfOpen';

// The breaker's "action" is a trampoline: it calls whatever function the
// caller passed to `fire(fn)`. This keeps one breaker per name while letting
// each call supply its own closure.
type Trampoline = (fn: () => Promise<unknown>) => Promise<unknown>;
const trampoline: Trampoline = (fn) => fn();

const DEFAULT_OPTIONS: CircuitBreaker.Options = {
  timeout: 10_000,
  errorThresholdPercentage: 50,
  rollingCountTimeout: 10_000,
  rollingCountBuckets: 10,
  volumeThreshold: 5,
  resetTimeout: 30_000,
};

export interface ScopedBreaker {
  fire<T>(fn: () => Promise<T>): Promise<T>;
  readonly name: string;
  readonly state: BreakerState;
}

interface RegistryEntry {
  breaker: CircuitBreaker<Parameters<Trampoline>, unknown>;
  name: string;
  scoped: ScopedBreaker;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Return the named breaker, creating it on first access. Each breaker has
 * independent state; share names across services only when they genuinely
 * share a failure domain.
 */
export function getBreaker(name: string, options: CircuitBreaker.Options = {}): ScopedBreaker {
  const existing = registry.get(name);
  if (existing) {
    return existing.scoped;
  }

  const breaker = new CircuitBreaker(trampoline, { ...DEFAULT_OPTIONS, ...options, name });
  breaker.on('open', () => logger.warn({ breaker: name }, 'circuit breaker open'));
  breaker.on('halfOpen', () => logger.info({ breaker: name }, 'circuit breaker half-open'));
  breaker.on('close', () => logger.info({ breaker: name }, 'circuit breaker closed'));

  const scoped: ScopedBreaker = {
    name,
    get state(): BreakerState {
      return breaker.opened ? 'open' : breaker.halfOpen ? 'halfOpen' : 'closed';
    },
    fire<T>(fn: () => Promise<T>): Promise<T> {
      return breaker.fire(fn) as Promise<T>;
    },
  };

  registry.set(name, { breaker, name, scoped });
  return scoped;
}

export interface BreakerSnapshot {
  name: string;
  state: BreakerState;
  stats: {
    failures: number;
    fires: number;
    rejects: number;
    successes: number;
    timeouts: number;
  };
}

/** Returns current state of every registered breaker. Drives metrics export. */
export function getBreakerStates(): BreakerSnapshot[] {
  const out: BreakerSnapshot[] = [];
  for (const { name, breaker } of registry.values()) {
    const state: BreakerState = breaker.opened ? 'open' : breaker.halfOpen ? 'halfOpen' : 'closed';
    const s = breaker.stats;
    out.push({
      name,
      state,
      stats: {
        fires: s.fires,
        failures: s.failures,
        successes: s.successes,
        rejects: s.rejects,
        timeouts: s.timeouts,
      },
    });
  }
  return out;
}

/** Test-only: clear the registry so each test starts fresh. */
export function _resetBreakers(): void {
  for (const { breaker } of registry.values()) {
    breaker.shutdown();
  }
  registry.clear();
}
