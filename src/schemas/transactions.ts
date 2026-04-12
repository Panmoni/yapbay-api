/**
 * Schemas for the `/transactions` routes.
 *
 * Mirrors `schema.sql` `transactions` table (lines 242-260).
 *
 * POST /transactions accepts either `transaction_hash` (EVM) or `signature`
 * (Solana) — at least one must be present. This is enforced via a top-level
 * refine rather than the factory pattern because the route handler already
 * handles both families in a single codepath.
 */

import { z } from 'zod';
import { transactionStatusEnum } from './primitives/enums';
import { dbId, dbIdParam } from './primitives/ids';
import { paginationQuery } from './primitives/pagination';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const dateOrIsoString = z.union([z.date(), z.string()]);

/**
 * Transaction types accepted by the POST endpoint.
 *
 * Superset of the DB enum — includes 'DISPUTE_ESCROW' which the handler maps
 * to 'OPEN_DISPUTE'.
 */
const recordTransactionTypeEnum = z.enum([
  'CREATE_ESCROW',
  'FUND_ESCROW',
  'RELEASE_ESCROW',
  'CANCEL_ESCROW',
  'MARK_FIAT_PAID',
  'OPEN_DISPUTE',
  'RESPOND_DISPUTE',
  'RESOLVE_DISPUTE',
  'DISPUTE_ESCROW',
  'OTHER',
]);

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/**
 * POST /transactions — record a blockchain transaction.
 *
 * At least one of `transaction_hash` or `signature` is required (enforced
 * by refine). `from_address` is required.
 */
export const recordTransactionRequestSchema = z
  .strictObject({
    block_number: z.number().int().nonnegative().optional(),
    escrow_id: z.union([z.string(), z.number()]).optional(),
    from_address: z.string().min(1, 'from_address is required'),
    metadata: z
      .union([
        z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        z.string(),
      ])
      .optional(),
    signature: z.string().optional(),
    status: transactionStatusEnum.default('PENDING'),
    to_address: z.string().optional(),
    trade_id: dbId,
    transaction_hash: z.string().optional(),
    transaction_type: recordTransactionTypeEnum,
  })
  .refine((d) => d.transaction_hash || d.signature, {
    message: 'Either transaction_hash or signature is required',
    path: ['transaction_hash'],
  });

/** GET /transactions/trade/:id params. */
export const transactionTradeIdParamsSchema = z.strictObject({
  id: dbIdParam,
});

/** GET /transactions/trade/:id query. */
export const transactionTradeQuerySchema = z
  .strictObject({
    type: z.string().optional(),
  })
  .strict();

/** GET /transactions/user query. */
export const transactionUserQuerySchema = paginationQuery
  .extend({
    type: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/** POST /transactions response. */
export const recordTransactionResponseSchema = z.strictObject({
  blockNumber: z.number().int().nullable(),
  success: z.literal(true),
  transactionId: z.number().int().positive(),
  txHash: z.string(),
});

/**
 * A transaction row as returned by the lookup endpoints.
 *
 * The lookup queries JOIN trades + networks and alias columns, so the shape
 * differs from a raw `SELECT * FROM transactions`.
 */
export const transactionLookupRowSchema = z.strictObject({
  amount: z.string().nullable().optional(),
  created_at: dateOrIsoString,
  error_message: z.string().nullable(),
  escrow_id: z.number().int().nullable(),
  from_address: z.string().nullable(),
  gas_used: z.string().nullable(),
  id: z.union([z.number(), z.string()]),
  metadata: z.unknown().nullable(),
  network: z.string().nullable(),
  to_address: z.string().nullable(),
  token_type: z.string().nullable().optional(),
  trade_id: z.number().int().nullable(),
  transaction_hash: z.string().nullable(),
  transaction_type: z.string(),
  status: z.string(),
});

/** GET /transactions/trade/:id response (array). */
export const transactionsByTradeResponseSchema = z.array(transactionLookupRowSchema);

/** GET /transactions/user response (array). */
export const transactionsByUserResponseSchema = z.array(transactionLookupRowSchema);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type RecordTransactionRequest = z.infer<typeof recordTransactionRequestSchema>;
export type TransactionLookupRow = z.infer<typeof transactionLookupRowSchema>;
