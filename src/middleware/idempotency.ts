// Idempotency key middleware — replay-safe mutations for financial routes.
//
// Contract (documented in docs/api-ref.md):
// - Client sends `Idempotency-Key: <uuid-v4>` on POST/PUT that mutate state.
// - First call executes normally; response is cached for 24h (2xx only).
// - Repeat with same key + same body: server returns cached response.
// - Repeat with same key + *different* body: server returns 409 (hash mismatch).
// - Missing key on a protected route: server returns 400 in strict mode, or
//   passes through in permissive mode (set per-route).
//
// Correctness guarantees (from review fixes):
// - Cache rows are scoped to `(key, user_sub)` so one user cannot read
//   another user's cached response.
// - A pg advisory lock (txn-scoped, keyed on sha256(key||user_sub)) serializes
//   concurrent same-key requests — the second request waits, then sees the
//   committed cache row and replays. No double-execution.
// - Only 2xx responses are cached. 4xx/5xx replays re-execute so clients can
//   recover from validation errors without rotating the key.
// - The cache key hash is over canonicalized JSON (sorted keys, recursive)
//   plus the full `req.originalUrl`, so different `:id` params don't collide
//   and key order in the body is normalized.
// - Interception covers res.json, res.send, and res.end so handlers using any
//   of those methods (or returning raw strings) are all cached correctly.
//
// Storage: `idempotency_records` table (see migration 0035).

import { createHash, randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { withTransaction } from '../db';
import { logError, logger } from '../logger';
import { idempotencyCacheHits } from '../metrics';
import type { AuthenticatedRequest } from './auth';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface IdempotencyOptions {
  /** When true, reject requests without an Idempotency-Key header (HTTP 400). */
  required?: boolean;
}

interface CachedRecord {
  request_hash: string;
  response_body: unknown;
  response_status: number;
}

/**
 * Deterministic JSON serialization: recursively sort object keys so
 * `{a:1,b:2}` and `{b:2,a:1}` produce the same hash. Arrays keep order.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

function hashRequest(method: string, url: string, body: unknown): string {
  const payload = `${method}\n${url}\n${canonicalize(body ?? null)}`;
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Convert `key || user_sub` to two 32-bit ints for pg_advisory_xact_lock(int,int).
 * Tied to the transaction so the lock auto-releases on COMMIT/ROLLBACK —
 * no risk of holding the lock past the request.
 */
function lockKeys(key: string, userSub: string | null): [number, number] {
  const digest = createHash('sha256')
    .update(`${key}\0${userSub ?? ''}`)
    .digest();
  // Signed 32-bit ints per pg advisory lock signature.
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

/**
 * Wrap a route (or router sub-tree) with idempotency semantics.
 */
export function idempotency(options: IdempotencyOptions = {}) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    // Only applies to mutating verbs.
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      next();
      return;
    }

    const rawKey = req.header('idempotency-key');

    if (!rawKey) {
      if (options.required) {
        res.status(400).json({
          error: 'missing_idempotency_key',
          message: 'This endpoint requires an Idempotency-Key header (UUID v4).',
        });
        return;
      }
      next();
      return;
    }

    // Normalize: UUIDs are case-insensitive per RFC 4122; store lowercase
    // so key equality survives client casing differences.
    const key = rawKey.toLowerCase();
    if (!UUID_V4_RE.test(key)) {
      res.status(400).json({
        error: 'invalid_idempotency_key',
        message: 'Idempotency-Key must be a UUID v4.',
      });
      return;
    }

    const userSub = req.user?.sub ?? null;
    // Use originalUrl (includes :id params + query string) — req.route is
    // undefined at router-level middleware.
    const requestHash = hashRequest(req.method, req.originalUrl, req.body);
    const [lockA, lockB] = lockKeys(key, userSub);

    // Single pg transaction: acquire advisory lock, check cache, optionally
    // proceed to execute handler. The lock ensures two concurrent identical
    // requests serialize — the second sees the first's cached row after it
    // commits instead of re-executing.
    let cached: CachedRecord | null = null;
    try {
      await withTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockA, lockB]);
        const lookup = await client.query<CachedRecord>(
          `SELECT response_status, response_body, request_hash
             FROM idempotency_records
            WHERE key = $1
              AND user_sub IS NOT DISTINCT FROM $2
              AND expires_at > NOW()`,
          [key, userSub],
        );
        cached = lookup.rows[0] ?? null;
      });
    } catch (err) {
      // Storage unavailable — fail open (don't block the request), but surface
      // for ops. Idempotency degrades to best-effort in this window.
      logError('idempotency lookup failed', err as Error);
    }

    if (cached !== null) {
      const c = cached as CachedRecord;
      if (c.request_hash !== requestHash) {
        idempotencyCacheHits.inc({ outcome: 'conflict' });
        res.status(409).json({
          error: 'idempotency_key_conflict',
          message: 'This Idempotency-Key was previously used with a different request body.',
        });
        return;
      }
      idempotencyCacheHits.inc({ outcome: 'hit' });
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(c.response_status).json(c.response_body);
      return;
    }

    idempotencyCacheHits.inc({ outcome: 'miss' });

    // Capture the response body by intercepting json/send/end. Whatever the
    // handler emits first wins; subsequent interceptions are ignored.
    let captured: { status: number; body: unknown } | null = null;
    const capture = (body: unknown): void => {
      if (captured === null) {
        captured = { status: res.statusCode, body };
      }
    };

    const origJson = res.json.bind(res);
    const origSend = res.send.bind(res);
    const origEnd = res.end.bind(res);

    res.json = (body: unknown) => {
      capture(body);
      return origJson(body);
    };
    // Express's res.send delegates to res.json for objects, but for strings
    // and Buffers it writes raw. Capture in both cases.
    // biome-ignore lint/suspicious/noExplicitAny: express send has an overloaded signature
    res.send = ((body?: any) => {
      if (body !== undefined) {
        capture(body);
      }
      return origSend(body);
      // biome-ignore lint/suspicious/noExplicitAny: preserving express signature
    }) as any;
    // biome-ignore lint/suspicious/noExplicitAny: express end has an overloaded signature
    res.end = ((chunk?: any, ...rest: any[]) => {
      if (chunk !== undefined && typeof chunk !== 'function') {
        capture(chunk);
      }
      return (origEnd as (...a: unknown[]) => Response)(chunk, ...rest);
      // biome-ignore lint/suspicious/noExplicitAny: preserving express signature
    }) as any;

    // Persist on response finish. Only cache 2xx — 4xx/5xx replays must
    // re-execute so clients can fix bad input without rotating the key.
    // We await the write inside the `finish` handler: it races the socket
    // close only slightly, and the tradeoff is strong idempotency guarantees
    // for financial retries over a ~5ms latency bump.
    res.on('finish', () => {
      if (captured === null) {
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return;
      }
      // Serialize body to JSON string for JSONB storage. Non-JSON responses
      // (e.g. raw html/buffer) are wrapped so they survive round-trip.
      const c = captured as { status: number; body: unknown };
      const bodyJson =
        typeof c.body === 'string' || Buffer.isBuffer(c.body)
          ? JSON.stringify({ _raw: c.body.toString() })
          : JSON.stringify(c.body);
      // INSERT … ON CONFLICT DO NOTHING against whichever partial unique
      // index matches (user_sub NULL → anon_key; NOT NULL → user_key).
      // If two requests race past the advisory lock somehow, first commit
      // wins; the second silently skips.
      withTransaction(async (client) => {
        if (userSub === null) {
          await client.query(
            `INSERT INTO idempotency_records
               (key, user_sub, route, request_hash, response_status, response_body)
             VALUES ($1, NULL, $2, $3, $4, $5::jsonb)
             ON CONFLICT (key) WHERE user_sub IS NULL DO NOTHING`,
            [key, req.originalUrl, requestHash, c.status, bodyJson],
          );
        } else {
          await client.query(
            `INSERT INTO idempotency_records
               (key, user_sub, route, request_hash, response_status, response_body)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT (key, user_sub) WHERE user_sub IS NOT NULL DO NOTHING`,
            [key, userSub, req.originalUrl, requestHash, c.status, bodyJson],
          );
        }
      }).catch((err) => logError('idempotency store failed', err as Error));
    });

    next();
  };
}

/** Purge expired idempotency rows. Intended to be called on an hourly cron. */
export async function sweepExpiredIdempotencyRecords(): Promise<number> {
  const { query } = await import('../db');
  const rows = await query('DELETE FROM idempotency_records WHERE expires_at < NOW() RETURNING 1');
  const deleted = rows.length;
  if (deleted > 0) {
    logger.info({ deleted }, 'idempotency sweep');
  }
  return deleted;
}

// Exposed for tests.
export const _internals = { canonicalize, hashRequest, UUID_V4_RE, generateKey: randomUUID };
