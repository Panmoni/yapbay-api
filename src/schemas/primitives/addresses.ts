/**
 * Address primitives.
 *
 * All address validation wraps {@link NetworkValidator} so format checks have a
 * single source of truth across the codebase.
 *
 * Mirrors `schema.sql`:
 *   - VARCHAR(42) for EVM addresses (0x + 40 hex)
 *   - VARCHAR(44) for Solana addresses (base58)
 */

import { z } from 'zod';
import { NetworkValidator } from '../../validation/networkValidation';

/** EVM address: 42 chars, 0x + 40 hex, validated via ethers.isAddress(). */
export const evmAddress = z
  .string()
  .min(1, 'EVM address is required')
  .refine((v) => NetworkValidator.validateAddress(v, 'evm'), {
    message: 'Invalid EVM address',
  });

/** Solana address: base58 string, decoded via PublicKey constructor. */
export const solanaAddress = z
  .string()
  .min(1, 'Solana address is required')
  .refine((v) => NetworkValidator.validateAddress(v, 'solana'), {
    message: 'Invalid Solana address',
  });

/** Solana PDA address: same format as a Solana address. */
export const solanaPDA = z
  .string()
  .min(1, 'Solana PDA is required')
  .refine((v) => NetworkValidator.validatePDA(v), {
    message: 'Invalid Solana PDA',
  });

/** Solana program ID: same format as a Solana address. */
export const solanaProgramId = z
  .string()
  .min(1, 'Solana program ID is required')
  .refine((v) => NetworkValidator.validateProgramId(v), {
    message: 'Invalid Solana program ID',
  });

/**
 * Network-aware address factory. Returns the right address primitive given
 * a network family. Used by the validate() middleware factory pattern for
 * polymorphic endpoints (e.g. POST /escrows/record).
 */
export const networkAddress = (family: 'evm' | 'solana') =>
  family === 'evm' ? evmAddress : solanaAddress;
