/**
 * Identifier primitives.
 *
 * Three flavours of "ID":
 *   1. Database row IDs (SERIAL, positive integers) — {@link dbId}, {@link dbIdParam}
 *   2. EVM on-chain escrow IDs (hex strings) — {@link evmEscrowId}
 *   3. Solana on-chain IDs (u64 stored as decimal string) — {@link solanaU64Id}, {@link onchainTradeId}
 *
 * Mirrors `schema.sql`:
 *   - id SERIAL PRIMARY KEY (numeric)
 *   - escrows.escrow_onchain_id VARCHAR(20) — Solana u64
 *   - escrows.trade_onchain_id VARCHAR(20) — Solana u64
 *   - trades.leg1_escrow_onchain_id VARCHAR(42) — EVM hex or Solana u64
 */

import { z } from 'zod';
import { NetworkValidator } from '../../validation/networkValidation';

/**
 * Database row ID for use in JSON request bodies.
 *
 * Strict: must already be a positive integer in the parsed JSON. Does not
 * accept strings — body fields should be typed as numbers by the client.
 */
export const dbId = z
  .number()
  .int('Database ID must be an integer')
  .positive('Database ID must be positive');

/**
 * Database row ID for use in URL params (`:id`).
 *
 * Coerces from string because Express provides URL params as strings.
 * Caps at Number.MAX_SAFE_INTEGER to avoid silent precision loss.
 */
export const dbIdParam = z.coerce
  .number()
  .int('ID must be an integer')
  .positive('ID must be positive')
  .max(Number.MAX_SAFE_INTEGER, 'ID exceeds safe integer range');

/** Maximum value of an unsigned 64-bit integer. */
const U64_MAX = 2n ** 64n - 1n;

/**
 * Solana u64 identifier as a decimal string.
 *
 * - Digits only, 1-20 chars (u64 max is 20 digits)
 * - Value must fit in u64 (≤ 2^64 - 1)
 * - No leading zeros except for "0" itself (which is rejected since u64 IDs
 *   in this codebase are never zero)
 */
export const solanaU64Id = z
  .string()
  .regex(/^(0|[1-9]\d{0,19})$/, 'Solana u64 ID must be a non-negative decimal string')
  .refine((s) => {
    try {
      const v = BigInt(s);
      return v > 0n && v <= U64_MAX;
    } catch {
      return false;
    }
  }, 'Solana u64 ID must be > 0 and fit in u64');

/** Alias for clarity at call sites — Solana on-chain trade IDs are u64 strings. */
export const onchainTradeId = solanaU64Id;

/**
 * EVM on-chain escrow ID: hex string.
 *
 * Wraps `NetworkValidator.validateEscrowId(..., 'evm')` which uses
 * `ethers.isHexString()`.
 */
export const evmEscrowId = z
  .string()
  .min(1, 'EVM escrow ID is required')
  .refine((v) => NetworkValidator.validateEscrowId(v, 'evm'), {
    message: 'Invalid EVM escrow ID (must be a hex string)',
  });
