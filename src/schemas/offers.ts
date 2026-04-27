/**
 * Schemas for the `/offers` routes.
 *
 * Mirrors `schema.sql` `offers` table:
 *   - creator_account_id INTEGER NOT NULL REFERENCES accounts(id)
 *   - network_id INTEGER NOT NULL REFERENCES networks(id)
 *   - offer_type VARCHAR(4) NOT NULL CHECK ('BUY','SELL')
 *   - token VARCHAR(10) NOT NULL DEFAULT 'USDC'
 *   - fiat_currency VARCHAR(3) NOT NULL DEFAULT 'USD'
 *   - min_amount DECIMAL(15,6) NOT NULL
 *   - max_amount DECIMAL(15,6) NOT NULL CHECK (max_amount >= min_amount)
 *   - total_available_amount DECIMAL(15,6) NOT NULL CHECK (>= max_amount)
 *   - rate_adjustment DECIMAL(6,4) NOT NULL
 *   - terms TEXT
 *   - escrow_deposit_time_limit INTERVAL NOT NULL DEFAULT '15 minutes'
 *   - fiat_payment_time_limit INTERVAL NOT NULL DEFAULT '30 minutes'
 *   - created_at, updated_at TIMESTAMP WITH TIME ZONE NOT NULL
 */

import { z } from 'zod';
import { usdcAmount } from './primitives/amounts';
import { fiatCurrency, networkTypeEnum, offerTypeEnum, tokenEnum } from './primitives/enums';
import { dbId, dbIdParam } from './primitives/ids';
import { paginationQuery } from './primitives/pagination';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const dateOrIsoString = z.union([z.date(), z.string()]);

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/**
 * POST /offers — create a new offer.
 *
 * All NOT NULL columns without a server-side default are required.
 * USDC amounts are strings (see plan: M3 cutover).
 */
export const createOfferRequestSchema = z.strictObject({
  creator_account_id: dbId,
  escrow_deposit_time_limit: z.string().optional(),
  fiat_currency: fiatCurrency.default('USD'),
  fiat_payment_time_limit: z.string().optional(),
  max_amount: usdcAmount.optional(),
  min_amount: usdcAmount,
  offer_type: offerTypeEnum,
  rate_adjustment: z.number().positive('Rate adjustment must be positive').optional(),
  terms: z.string().optional(),
  token: tokenEnum.optional(),
  total_available_amount: usdcAmount.optional(),
});

/**
 * PUT /offers/:id — update an existing offer.
 *
 * All fields optional. Only supplied fields are updated via COALESCE.
 */
export const updateOfferRequestSchema = z.strictObject({
  escrow_deposit_time_limit: z
    .union([z.string(), z.strictObject({ minutes: z.number().positive() })])
    .optional(),
  fiat_currency: fiatCurrency.optional(),
  fiat_payment_time_limit: z
    .union([z.string(), z.strictObject({ minutes: z.number().positive() })])
    .optional(),
  max_amount: usdcAmount.optional(),
  min_amount: usdcAmount.optional(),
  offer_type: offerTypeEnum.optional(),
  rate_adjustment: z.number().positive('Rate adjustment must be positive').optional(),
  terms: z.string().optional(),
  token: tokenEnum.optional(),
  total_available_amount: usdcAmount.optional(),
});

/** URL params for /offers/:id. */
export const offerIdParamsSchema = z.strictObject({
  id: dbIdParam,
});

/**
 * GET /offers query params (public list).
 *
 * Extends pagination with optional filters.
 */
export const listOffersQuerySchema = paginationQuery
  .extend({
    owner: z.string().optional(),
    token: z.string().optional(),
    type: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/**
 * Postgres `INTERVAL` columns come back through `node-postgres` as a
 * `PostgresInterval` object (`{ years?, months?, days?, hours?, minutes?,
 * seconds?, milliseconds? }`), NOT a string. The schema must accept either
 * that object shape or the string form (which arrives when the column was
 * inserted as a literal like `'15 minutes'` and pg short-circuits the
 * parse). Frontends already handle both via `parseTimeLimit`.
 */
const intervalLike = z.union([z.string(), z.object({}).passthrough()]).nullable();

/** A single offer row as returned by pg (RETURNING * or SELECT *). */
export const offerRowSchema = z.strictObject({
  created_at: dateOrIsoString,
  creator_account_id: z.number().int(),
  escrow_deposit_time_limit: intervalLike,
  fiat_currency: z.string(),
  fiat_payment_time_limit: intervalLike,
  id: z.number().int().positive(),
  max_amount: z.string(),
  min_amount: z.string(),
  network_id: z.number().int(),
  offer_type: z.string(),
  rate_adjustment: z.string(),
  terms: z.string().nullable(),
  token: z.string(),
  total_available_amount: z.string(),
  updated_at: dateOrIsoString,
});

/** POST /offers response: `{ network, offer }`. */
export const createOfferResponseSchema = z.strictObject({
  network: networkTypeEnum,
  offer: offerRowSchema,
});

/** PUT /offers/:id response: `{ network, offer }`. */
export const updateOfferResponseSchema = z.strictObject({
  network: networkTypeEnum,
  offer: offerRowSchema,
});

/** GET /offers/:id response: `{ network, offer }`. */
export const getOfferResponseSchema = z.strictObject({
  network: networkTypeEnum,
  offer: offerRowSchema,
});

/** GET /offers response: `{ network, offers }`. */
export const listOffersResponseSchema = z.strictObject({
  network: networkTypeEnum,
  offers: z.array(offerRowSchema),
});

/** DELETE /offers/:id response. */
export const deleteOfferResponseSchema = z.strictObject({
  message: z.literal('Offer deleted'),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type CreateOfferRequest = z.infer<typeof createOfferRequestSchema>;
export type UpdateOfferRequest = z.infer<typeof updateOfferRequestSchema>;
export type OfferRow = z.infer<typeof offerRowSchema>;
