/**
 * Transaction hash / signature primitives.
 *
 * Wraps {@link NetworkValidator} format checks.
 *
 * Mirrors `schema.sql`:
 *   - transactions.transaction_hash VARCHAR(88) — EVM 0x + 64 hex (66 chars total)
 *   - transactions.signature VARCHAR(88) — Solana base58 (87-88 chars)
 */

import { z } from 'zod';
import { NetworkValidator } from '../../validation/networkValidation';

/** EVM transaction hash: 0x + 64 hex chars (66 total). */
export const evmTxHash = z
  .string()
  .min(1, 'EVM transaction hash is required')
  .refine((v) => NetworkValidator.validateTransactionHash(v, 'evm'), {
    message: 'Invalid EVM transaction hash (must be 0x + 64 hex chars)',
  });

/** Solana transaction signature: base58, 87-88 chars. */
export const solanaSignature = z
  .string()
  .min(1, 'Solana signature is required')
  .refine((v) => NetworkValidator.validateTransactionHash(v, 'solana'), {
    message: 'Invalid Solana signature (must be base58, 87-88 chars)',
  });

/**
 * Network-aware transaction-hash factory. Returns the right hash primitive
 * given a network family.
 */
export const networkTxHash = (family: 'evm' | 'solana') =>
  family === 'evm' ? evmTxHash : solanaSignature;
