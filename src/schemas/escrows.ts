/**
 * Schemas for the `/escrows` routes.
 *
 * The escrow record endpoint is the most dangerous in the API — it accepts
 * blockchain-specific data (addresses, signatures, PDAs) and writes to the
 * escrows table. Shape validation is STRICT, network-family-aware via the
 * factory pattern.
 *
 * Mirrors `schema.sql` `escrows` table (lines 172-205).
 *
 * IMPORTANT: `amount` is a STRING (hard cutover, no number fallback).
 */

import { z } from 'zod';
import { evmAddress, solanaAddress, solanaPDA, solanaProgramId } from './primitives/addresses';
import { escrowUsdcAmount } from './primitives/amounts';
import { networkFamilyEnum, networkTypeEnum } from './primitives/enums';
import { evmTxHash, solanaSignature } from './primitives/hashes';
import { dbId, evmEscrowId, solanaU64Id } from './primitives/ids';
import { paginationQuery } from './primitives/pagination';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const dateOrIsoString = z.union([z.date(), z.string()]);

// ---------------------------------------------------------------------------
// Request schemas — EVM / Solana factory
// ---------------------------------------------------------------------------

/**
 * Base fields shared by both EVM and Solana escrow record requests.
 */
const baseEscrowRecordFields = {
  amount: escrowUsdcAmount,
  buyer: z.string().min(1),
  seller: z.string().min(1),
  sequential: z.boolean().optional().default(false),
  sequential_escrow_address: z.string().optional(),
  trade_id: dbId,
};

/**
 * EVM escrow record request.
 *
 * Requires `transaction_hash` (0x + 64 hex) and `escrow_id` (hex string).
 * No Solana-specific fields.
 */
export const evmEscrowRecordSchema = z
  .strictObject({
    ...baseEscrowRecordFields,
    buyer: evmAddress,
    escrow_id: evmEscrowId,
    seller: evmAddress,
    sequential_escrow_address: evmAddress.optional(),
    transaction_hash: evmTxHash,
  })
  .refine((d) => !d.sequential || d.sequential_escrow_address, {
    message: 'sequential_escrow_address required when sequential=true',
    path: ['sequential_escrow_address'],
  });

/**
 * Solana escrow record request.
 *
 * Requires `signature` (base58), Solana-specific fields: `program_id`,
 * `escrow_pda`, `escrow_token_account`, `trade_onchain_id`.
 */
export const solanaEscrowRecordSchema = z
  .strictObject({
    ...baseEscrowRecordFields,
    buyer: solanaAddress,
    escrow_id: solanaU64Id,
    escrow_pda: solanaPDA,
    escrow_token_account: solanaPDA,
    program_id: solanaProgramId,
    seller: solanaAddress,
    sequential_escrow_address: solanaAddress.optional(),
    signature: solanaSignature,
    trade_onchain_id: solanaU64Id,
  })
  .refine((d) => !d.sequential || d.sequential_escrow_address, {
    message: 'sequential_escrow_address required when sequential=true',
    path: ['sequential_escrow_address'],
  });

/**
 * Network-aware escrow record schema factory.
 *
 * Called by `validate((req) => ({ body: escrowRecordSchemaFor(req.network!.networkFamily) }))`.
 */
export const escrowRecordSchemaFor = (family: 'evm' | 'solana') =>
  family === 'evm' ? evmEscrowRecordSchema : solanaEscrowRecordSchema;

/** URL params for blockchain routes: /escrows/:onchainEscrowId/... */
export const onchainEscrowIdParamsSchema = z.strictObject({
  onchainEscrowId: z.string().min(1, 'onchainEscrowId is required'),
});

/** GET /escrows/my query params. */
export const listMyEscrowsQuerySchema = paginationQuery.extend({}).strict();

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/**
 * POST /escrows/record response.
 */
export const escrowRecordResponseSchema = z.strictObject({
  blockExplorerUrl: z.string(),
  escrowDbId: z.number().int().positive(),
  escrowId: z.string(),
  networkFamily: networkFamilyEnum,
  success: z.literal(true),
  txHash: z.string(),
});

/**
 * Escrow row as returned by SELECT * (GET /escrows/my includes network join).
 *
 * Many fields nullable — Solana-specific fields are null on EVM rows and
 * vice versa.
 */
export const escrowRowSchema = z.strictObject({
  amount: z.string(),
  arbitrator_address: z.string(),
  buyer_address: z.string(),
  completed_at: dateOrIsoString.nullable().optional(),
  counter: z.number().int(),
  created_at: dateOrIsoString,
  current_balance: z.string().nullable(),
  deposit_deadline: dateOrIsoString.nullable().optional(),
  dispute_id: z.number().int().nullable().optional(),
  escrow_address: z.string(),
  escrow_onchain_id: z.string().nullable().optional(),
  escrow_pda: z.string().nullable().optional(),
  escrow_token_account: z.string().nullable().optional(),
  fiat_deadline: dateOrIsoString.nullable().optional(),
  fiat_paid: z.boolean(),
  id: z.number().int().positive(),
  network: z.string().optional(),
  network_family: z.string(),
  network_id: z.number().int(),
  onchain_escrow_id: z.string().nullable().optional(),
  program_id: z.string().nullable().optional(),
  seller_address: z.string(),
  sequential: z.boolean(),
  sequential_escrow_address: z.string().nullable().optional(),
  state: z.string(),
  token_type: z.string(),
  trade_id: z.number().int(),
  trade_onchain_id: z.string().nullable().optional(),
  updated_at: dateOrIsoString,
  version: z.string().nullable().optional(),
});

/** GET /escrows/my response (array of escrow rows). */
export const listMyEscrowsResponseSchema = z.array(escrowRowSchema);

/** Blockchain GET responses (Celo/legacy — kept for completeness). */
export const escrowBalanceResponseSchema = z.strictObject({
  balance: z.string(),
  escrowId: z.string(),
  network: networkTypeEnum,
});

export const escrowStoredBalanceResponseSchema = z.strictObject({
  escrowId: z.string(),
  storedBalance: z.string(),
});

export const escrowCalculatedBalanceResponseSchema = z.strictObject({
  calculatedBalance: z.string(),
  escrowId: z.string(),
});

export const escrowSequentialInfoResponseSchema = z.strictObject({
  escrowId: z.string(),
  network: networkTypeEnum,
  sequentialInfo: z.unknown(),
});

export const escrowAutoCancelResponseSchema = z.strictObject({
  escrowId: z.string(),
  isEligibleForAutoCancel: z.boolean(),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type EvmEscrowRecord = z.infer<typeof evmEscrowRecordSchema>;
export type SolanaEscrowRecord = z.infer<typeof solanaEscrowRecordSchema>;
export type EscrowRecord = EvmEscrowRecord | SolanaEscrowRecord;
export type EscrowRow = z.infer<typeof escrowRowSchema>;
