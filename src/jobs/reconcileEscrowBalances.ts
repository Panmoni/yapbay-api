// Daily reconciliation: for every active escrow, compare the stored
// `current_balance` against the on-chain balance. Mismatches beyond
// tolerance are logged with forensic context and, if RECONCILIATION_WEBHOOK
// is configured, POSTed to the alert endpoint (HMAC-signed, URL-validated,
// timeout-bounded).
//
// This is advisory infrastructure, not a mutation: the job never writes
// corrections automatically. Divergence requires human review because it
// implies either (a) a missed listener event, (b) a bug in the escrow
// funding path, or (c) external on-chain activity.
//
// Wired into `server.ts` as a daily cron (04:00 UTC). The caller supplies a
// chain-aware `OnchainBalanceFetcher` so this module doesn't import the
// Solana/Celo service layers at module load time — keeps reconciliation
// testable without bringing up the full app.

import { createHmac } from 'node:crypto';
import { query } from '../db';
import { logger } from '../logger';
import { decimalMath } from '../utils/decimalMath';

// Floor tolerance: 0.01 USDC (10_000 micro-units). Smaller than realistic
// fee/rounding noise but still meaningful for tiny escrows. For larger
// balances we scale up via `TOLERANCE_BPS` (basis points of the stored
// balance) so a $1M escrow doesn't alert on one-micro-unit drift.
const TOLERANCE_FLOOR_MICRO = 10_000n;
// Default 10 basis points = 0.1% of stored balance.
const TOLERANCE_BPS = BigInt(process.env.RECONCILIATION_TOLERANCE_BPS ?? 10);
const BPS_DENOM = 10_000n;

// Parallelism per batch. 25 keeps tail latency bounded while not flooding
// RPC endpoints. Tunable via env without a code change.
const RECONCILE_CONCURRENCY = Number(process.env.RECONCILIATION_CONCURRENCY ?? 25);

// Safety cap on rows per run. If the active set exceeds this, we log and
// truncate rather than run for hours. Operator investigates why.
const RECONCILE_ROW_LIMIT = Number(process.env.RECONCILIATION_ROW_LIMIT ?? 10_000);

// Webhook fetch timeout. 5 s is long enough for sane receivers, short
// enough that a broken endpoint can't wedge the cron.
const WEBHOOK_TIMEOUT_MS = Number(process.env.RECONCILIATION_WEBHOOK_TIMEOUT_MS ?? 5000);

export interface ReconciliationRow {
  diff_micro: string;
  escrow_db_id: number;
  network_id: number;
  onchain_balance: string | null;
  onchain_escrow_id: string;
  reason: string;
  stored_balance: string;
}

/**
 * Hook supplied by the caller: given (networkId, onchainEscrowId) return the
 * current on-chain balance as a decimal string, or null to skip. Any other
 * return type (undefined, empty string, number) is treated as a fetcher bug
 * and the escrow is skipped with a warning.
 */
export type OnchainBalanceFetcher = (
  networkId: number,
  onchainEscrowId: string,
) => Promise<string | null>;

export interface ReconciliationResult {
  checked: number;
  mismatches: ReconciliationRow[];
  skipped: number;
  truncated: boolean;
}

interface EscrowRow {
  current_balance: string;
  id: number;
  network_id: number;
  onchain_escrow_id: string;
  state: string;
}

function computeToleranceMicro(storedMicro: bigint): bigint {
  const abs = storedMicro < 0n ? -storedMicro : storedMicro;
  const scaled = (abs * TOLERANCE_BPS) / BPS_DENOM;
  return scaled > TOLERANCE_FLOOR_MICRO ? scaled : TOLERANCE_FLOOR_MICRO;
}

function buildMismatch(
  row: EscrowRow,
  onchain: string,
  stored: bigint,
  live: bigint,
): ReconciliationRow {
  const diff = stored - live;
  return {
    escrow_db_id: row.id,
    onchain_escrow_id: row.onchain_escrow_id,
    network_id: row.network_id,
    stored_balance: row.current_balance,
    onchain_balance: onchain,
    diff_micro: diff.toString(),
    reason: stored > live ? 'db_ahead' : 'onchain_ahead',
  };
}

async function checkOne(
  row: EscrowRow,
  fetchOnchainBalance: OnchainBalanceFetcher,
): Promise<{ kind: 'mismatch'; row: ReconciliationRow } | { kind: 'skip' } | { kind: 'ok' }> {
  let onchain: string | null;
  try {
    onchain = await fetchOnchainBalance(row.network_id, row.onchain_escrow_id);
  } catch (err) {
    logger.warn(
      { err, escrow: row.id, onchain_escrow_id: row.onchain_escrow_id },
      'reconcile: onchain fetch failed',
    );
    return { kind: 'skip' };
  }

  // Defensive: contract says `string | null`; treat anything else as a bug.
  if (onchain === null) {
    return { kind: 'skip' };
  }
  if (typeof onchain !== 'string' || onchain === '') {
    logger.warn(
      { escrow: row.id, onchain_escrow_id: row.onchain_escrow_id, onchain },
      'reconcile: fetcher returned unexpected value',
    );
    return { kind: 'skip' };
  }

  let stored: bigint;
  let live: bigint;
  try {
    stored = decimalMath.toMicro(row.current_balance ?? '0');
    live = decimalMath.toMicro(onchain);
  } catch (err) {
    logger.warn(
      { err, escrow: row.id, stored: row.current_balance, onchain },
      'reconcile: decimal parse failed',
    );
    return { kind: 'skip' };
  }

  const diff = stored - live;
  const absDiff = diff < 0n ? -diff : diff;
  if (absDiff > computeToleranceMicro(stored)) {
    const mismatch = buildMismatch(row, onchain, stored, live);
    logger.warn(mismatch, 'reconcile: balance mismatch beyond tolerance');
    return { kind: 'mismatch', row: mismatch };
  }
  return { kind: 'ok' };
}

async function runInChunks<T, R>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const chunkResults = await Promise.allSettled(slice.map(worker));
    for (const r of chunkResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      }
    }
  }
  return results;
}

/**
 * Walk the active escrows table and compare `current_balance` to on-chain
 * value. Returns a summary; callers decide whether to alert.
 */
export async function reconcileEscrowBalances(
  fetchOnchainBalance: OnchainBalanceFetcher,
): Promise<ReconciliationResult> {
  const rows = (await query(
    `SELECT id, onchain_escrow_id, network_id, current_balance, state
       FROM escrows
      WHERE state NOT IN ('RELEASED', 'CANCELLED', 'AUTO_CANCELLED', 'RESOLVED')
        AND onchain_escrow_id IS NOT NULL
      LIMIT $1`,
    [RECONCILE_ROW_LIMIT],
  )) as EscrowRow[];

  const truncated = rows.length >= RECONCILE_ROW_LIMIT;
  if (truncated) {
    logger.warn(
      { limit: RECONCILE_ROW_LIMIT, returned: rows.length },
      'reconcile: row limit hit — active escrow set may exceed limit; investigate',
    );
  }

  const outcomes = await runInChunks(rows, RECONCILE_CONCURRENCY, (row) =>
    checkOne(row, fetchOnchainBalance),
  );

  const mismatches: ReconciliationRow[] = [];
  let skipped = 0;
  for (const outcome of outcomes) {
    if (outcome.kind === 'mismatch') {
      mismatches.push(outcome.row);
    } else if (outcome.kind === 'skip') {
      skipped++;
    }
  }

  logger.info(
    { checked: rows.length, mismatches: mismatches.length, skipped, truncated },
    'reconcile: completed',
  );

  if (mismatches.length > 0 && process.env.RECONCILIATION_WEBHOOK) {
    await postAlert(process.env.RECONCILIATION_WEBHOOK, mismatches).catch((err) =>
      logger.error({ err }, 'reconcile: webhook post failed'),
    );
  }

  return { checked: rows.length, mismatches, skipped, truncated };
}

function validateWebhookUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`reconcile: webhook must be http(s), got ${url.protocol}`);
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('reconcile: webhook must be https:// in production');
  }
  return url;
}

async function postAlert(rawUrl: string, mismatches: ReconciliationRow[]): Promise<void> {
  const url = validateWebhookUrl(rawUrl);
  const body = JSON.stringify({
    service: 'yapbay-api',
    event: 'escrow_balance_mismatch',
    mismatches,
    ts: new Date().toISOString(),
  });

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'yapbay-api/reconcile',
  };
  // HMAC-sign the body if a shared secret is configured so the receiver can
  // verify the alert came from us, not a spoofer with the URL.
  const secret = process.env.RECONCILIATION_WEBHOOK_SECRET;
  if (secret) {
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    headers['x-yapbay-signature'] = `sha256=${sig}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`webhook status ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
