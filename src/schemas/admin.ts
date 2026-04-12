/**
 * Schemas for admin + auth routes.
 *
 * Admin routes:
 *   GET /admin/trades — paginated trade list
 *   GET /admin/escrows/:trade_id — escrow by trade
 *   GET /admin/deadline-stats — all networks
 *   GET /admin/deadline-stats/:networkId — per-network
 *
 * Auth routes:
 *   POST /admin/login — admin JWT login
 */

import { z } from 'zod';
import { escrowRowSchema } from './escrows';
import { dbIdParam } from './primitives/ids';
import { tradeRowSchema } from './trades';

// ---------------------------------------------------------------------------
// Admin trades
// ---------------------------------------------------------------------------

/**
 * GET /admin/trades query — uses page/limit instead of offset/limit.
 * The handler computes offset from page.
 */
export const adminTradesQuerySchema = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(10),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();

/** GET /admin/trades response. */
export const adminTradesResponseSchema = z.strictObject({
  data: z.array(tradeRowSchema),
  meta: z.strictObject({
    limit: z.number().int(),
    page: z.number().int(),
    total: z.number().int().nonnegative(),
  }),
});

// ---------------------------------------------------------------------------
// Admin escrows
// ---------------------------------------------------------------------------

/** GET /admin/escrows/:trade_id params. */
export const adminEscrowParamsSchema = z.strictObject({
  trade_id: dbIdParam,
});

/** GET /admin/escrows/:trade_id response — single escrow row. */
export const adminEscrowResponseSchema = escrowRowSchema;

// ---------------------------------------------------------------------------
// Admin deadline stats
// ---------------------------------------------------------------------------

/** GET /admin/deadline-stats — no query params. */
export const deadlineStatsQuerySchema = z.strictObject({});

/** GET /admin/deadline-stats/:networkId params. */
export const deadlineStatsNetworkIdParamsSchema = z.strictObject({
  networkId: dbIdParam,
});

/**
 * Deadline stats response shape is dynamic (depends on service layer) so
 * we validate the wrapper and let the `data` field be loose.
 */
export const deadlineStatsAllResponseSchema = z.strictObject({
  data: z.unknown(),
  success: z.literal(true),
  timestamp: z.string(),
});

export const deadlineStatsNetworkResponseSchema = z.strictObject({
  data: z.unknown(),
  success: z.literal(true),
  timestamp: z.string(),
});

// ---------------------------------------------------------------------------
// Auth — admin login
// ---------------------------------------------------------------------------

/** POST /admin/login request. */
export const adminLoginRequestSchema = z.strictObject({
  password: z.string().min(1, 'Password is required'),
  username: z.string().min(1, 'Username is required'),
});

/** POST /admin/login response. */
export const adminLoginResponseSchema = z.strictObject({
  token: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;
