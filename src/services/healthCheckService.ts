import { Connection } from '@solana/web3.js';
import { query } from '../db';
import { logError } from '../logger';
import { getListenerHealth } from '../server';
import { NetworkFamily } from '../types/networks';
import { NetworkService } from './networkService';

export type CheckStatus = 'ok' | 'degraded' | 'down';

export interface SubCheck {
  detail?: string;
  latencyMs?: number;
  status: CheckStatus;
}

export interface ReadinessReport {
  checks: {
    db: SubCheck;
    listener: SubCheck;
    rpc: SubCheck;
  };
  status: CheckStatus;
  timestamp: string;
}

interface CachedValue<T> {
  at: number;
  value: T;
}

/**
 * Per-sub-check TTLs. DB is not cached — if the DB dies, readiness must go
 * red immediately so load balancers drain the node. RPC + listener are
 * cached to avoid hammering downstream on every probe.
 */
const TTL_MS = {
  db: 0,
  listener: 5000,
  rpc: 30_000,
} as const;

const cache: {
  db?: CachedValue<SubCheck>;
  listener?: CachedValue<SubCheck>;
  rpc?: CachedValue<SubCheck>;
} = {};

function fresh<T>(entry: CachedValue<T> | undefined, ttl: number): T | undefined {
  if (!entry || ttl <= 0) {
    return undefined;
  }
  if (Date.now() - entry.at > ttl) {
    return undefined;
  }
  return entry.value;
}

async function checkDb(): Promise<SubCheck> {
  const cached = fresh(cache.db, TTL_MS.db);
  if (cached) {
    return cached;
  }
  const start = Date.now();
  try {
    await query('SELECT 1');
    const check: SubCheck = { status: 'ok', latencyMs: Date.now() - start };
    cache.db = { value: check, at: Date.now() };
    return check;
  } catch (err) {
    logError('Health check DB probe failed', err);
    const check: SubCheck = {
      status: 'down',
      latencyMs: Date.now() - start,
      detail: 'database unreachable',
    };
    cache.db = { value: check, at: Date.now() };
    return check;
  }
}

function checkListener(): SubCheck {
  const cached = fresh(cache.listener, TTL_MS.listener);
  if (cached) {
    return cached;
  }
  const { healthy, listenerCount } = getListenerHealth();
  const check: SubCheck = {
    status: healthy ? 'ok' : 'degraded',
    detail: `listenerCount=${listenerCount}`,
  };
  cache.listener = { value: check, at: Date.now() };
  return check;
}

async function checkRpc(): Promise<SubCheck> {
  const cached = fresh(cache.rpc, TTL_MS.rpc);
  if (cached) {
    return cached;
  }
  const start = Date.now();
  try {
    const networks = await NetworkService.getAllNetworks();
    const solana = networks.find((n) => n.isActive && n.networkFamily === NetworkFamily.SOLANA);
    if (!solana) {
      const check: SubCheck = { status: 'degraded', detail: 'no active Solana network' };
      cache.rpc = { value: check, at: Date.now() };
      return check;
    }
    const connection = new Connection(solana.rpcUrl);
    await connection.getVersion();
    const check: SubCheck = { status: 'ok', latencyMs: Date.now() - start };
    cache.rpc = { value: check, at: Date.now() };
    return check;
  } catch (err) {
    logError('Health check RPC probe failed', err);
    const check: SubCheck = {
      status: 'degraded',
      latencyMs: Date.now() - start,
      detail: 'rpc unreachable',
    };
    cache.rpc = { value: check, at: Date.now() };
    return check;
  }
}

function aggregate(checks: ReadinessReport['checks']): CheckStatus {
  const values = Object.values(checks).map((c) => c.status);
  if (values.includes('down')) {
    return 'down';
  }
  if (values.includes('degraded')) {
    return 'degraded';
  }
  return 'ok';
}

export async function getReadiness(): Promise<ReadinessReport> {
  const [db, rpc] = await Promise.all([checkDb(), checkRpc()]);
  const listener = checkListener();
  const checks = { db, listener, rpc };
  return {
    status: aggregate(checks),
    checks,
    timestamp: new Date().toISOString(),
  };
}
