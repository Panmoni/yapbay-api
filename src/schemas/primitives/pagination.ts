/**
 * Pagination primitives.
 *
 * Strict by design: unknown query params are rejected by `validate()` because
 * routes use `z.strictObject()` for query schemas. Caps prevent
 * `?limit=999999999` DoS attempts.
 */

import { z } from 'zod';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;

/**
 * Standard pagination query: `?limit=N&offset=N`.
 *
 * - `limit`: 1..100, default 25 (capped to prevent DoS via `?limit=999999999`)
 * - `offset`: 0..100_000, default 0 (capped to force cursor pagination beyond)
 *
 * Both fields are coerced from string because Express provides query values
 * as strings.
 *
 * Routes that need additional query fields should `.extend()` this base, e.g.
 * `paginationQuery.extend({ status: tradeStatusEnum })`. The result remains
 * strict.
 */
export const paginationQuery = z.strictObject({
  limit: z.coerce
    .number()
    .int('limit must be an integer')
    .min(1, 'limit must be >= 1')
    .max(MAX_LIMIT, `limit must be <= ${MAX_LIMIT}`)
    .default(DEFAULT_LIMIT),
  offset: z.coerce
    .number()
    .int('offset must be an integer')
    .min(0, 'offset must be >= 0')
    .max(MAX_OFFSET, `offset must be <= ${MAX_OFFSET}`)
    .default(0),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;
