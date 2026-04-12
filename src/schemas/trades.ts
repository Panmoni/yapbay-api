/**
 * Schemas for the `/trades` routes.
 *
 * Mirrors `schema.sql` `trades` table — a complex two-leg structure with
 * extensive nullable columns. See schema.sql lines 114-169.
 *
 * M3 scope: POST + GET schemas. PUT (state-changing) deferred to M4.
 */

import { z } from 'zod';
import { usdcAmount } from './primitives/amounts';
import { fiatCurrency, networkTypeEnum } from './primitives/enums';
import { dbId, dbIdParam } from './primitives/ids';
import { paginationQuery } from './primitives/pagination';
import { legStateEnum, overallStatusEnum } from './primitives/states';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const dateOrIsoString = z.union([z.date(), z.string()]);

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/**
 * POST /trades — initiate a trade.
 *
 * USDC amounts are strings (M3 cutover).
 */
export const createTradeRequestSchema = z.strictObject({
  destination_bank: z.string().max(50).optional(),
  destination_fiat_currency: fiatCurrency.optional(),
  from_bank: z.string().max(50).optional(),
  from_fiat_currency: fiatCurrency.optional(),
  leg1_crypto_amount: usdcAmount.optional(),
  leg1_fiat_amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Fiat amount invalid')
    .optional(),
  leg1_offer_id: dbId,
  leg2_offer_id: dbId.optional(),
});

/**
 * PUT /trades/:id — update trade state (deferred to M4).
 *
 * Included here so M4 only needs to wire it, not design it.
 */
export const updateTradeRequestSchema = z.strictObject({
  fiat_paid: z.boolean().optional(),
  leg1_state: legStateEnum.optional(),
  overall_status: overallStatusEnum.optional(),
});

/** URL params for /trades/:id. */
export const tradeIdParamsSchema = z.strictObject({
  id: dbIdParam,
});

/** GET /trades/my query params. */
export const listMyTradesQuerySchema = paginationQuery.extend({}).strict();

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/**
 * A single trade row as returned by pg (SELECT *).
 *
 * Many columns are nullable because leg2 is optional and timestamps are set
 * by various state transitions.
 */
export const tradeRowSchema = z.strictObject({
  // Core
  cancelled: z.boolean(),
  cancelled_at: dateOrIsoString.nullable().optional(),
  completed: z.boolean(),
  completed_at: dateOrIsoString.nullable().optional(),
  created_at: dateOrIsoString,
  destination_bank: z.string().nullable(),
  destination_fiat_currency: z.string(),
  from_bank: z.string().nullable(),
  from_fiat_currency: z.string(),
  id: z.number().int().positive(),
  leg1_offer_id: z.number().int().nullable(),
  leg2_offer_id: z.number().int().nullable(),
  network_id: z.number().int(),
  overall_status: z.string(),
  updated_at: dateOrIsoString,

  // Leg 1
  leg1_buyer_account_id: z.number().int().nullable(),
  leg1_cancelled_at: dateOrIsoString.nullable().optional(),
  leg1_cancelled_by: z.string().nullable().optional(),
  leg1_created_at: dateOrIsoString,
  leg1_crypto_amount: z.string(),
  leg1_crypto_token: z.string(),
  leg1_dispute_id: z.number().int().nullable().optional(),
  leg1_escrow_address: z.string().nullable().optional(),
  leg1_escrow_deposit_deadline: dateOrIsoString.nullable().optional(),
  leg1_escrow_onchain_id: z.string().nullable().optional(),
  leg1_fiat_amount: z.string().nullable(),
  leg1_fiat_currency: z.string(),
  leg1_fiat_paid_at: dateOrIsoString.nullable().optional(),
  leg1_fiat_payment_deadline: dateOrIsoString.nullable().optional(),
  leg1_released_at: dateOrIsoString.nullable().optional(),
  leg1_seller_account_id: z.number().int().nullable(),
  leg1_state: z.string(),

  // Leg 2 (all nullable — optional leg)
  leg2_buyer_account_id: z.number().int().nullable().optional(),
  leg2_cancelled_at: dateOrIsoString.nullable().optional(),
  leg2_cancelled_by: z.string().nullable().optional(),
  leg2_created_at: dateOrIsoString.nullable().optional(),
  leg2_crypto_amount: z.string().nullable().optional(),
  leg2_crypto_token: z.string().nullable().optional(),
  leg2_dispute_id: z.number().int().nullable().optional(),
  leg2_escrow_address: z.string().nullable().optional(),
  leg2_escrow_deposit_deadline: dateOrIsoString.nullable().optional(),
  leg2_escrow_onchain_id: z.string().nullable().optional(),
  leg2_fiat_amount: z.string().nullable().optional(),
  leg2_fiat_currency: z.string().nullable().optional(),
  leg2_fiat_paid_at: dateOrIsoString.nullable().optional(),
  leg2_fiat_payment_deadline: dateOrIsoString.nullable().optional(),
  leg2_released_at: dateOrIsoString.nullable().optional(),
  leg2_seller_account_id: z.number().int().nullable().optional(),
  leg2_state: z.string().nullable().optional(),
});

/** POST /trades response: `{ network, trade }`. */
export const createTradeResponseSchema = z.strictObject({
  network: networkTypeEnum,
  trade: tradeRowSchema,
});

/** GET /trades/:id response: `{ network, trade }`. */
export const getTradeResponseSchema = z.strictObject({
  network: networkTypeEnum,
  trade: tradeRowSchema,
});

/** GET /trades/my response: `{ network, trades }`. */
export const listMyTradesResponseSchema = z.strictObject({
  network: networkTypeEnum,
  trades: z.array(tradeRowSchema),
});

/** PUT /trades/:id mutation response. */
export const tradeUpdateResponseSchema = z.strictObject({
  id: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type CreateTradeRequest = z.infer<typeof createTradeRequestSchema>;
export type UpdateTradeRequest = z.infer<typeof updateTradeRequestSchema>;
export type TradeRow = z.infer<typeof tradeRowSchema>;
