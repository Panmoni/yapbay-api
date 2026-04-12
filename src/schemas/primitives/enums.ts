/**
 * Domain enum primitives.
 *
 * All enum values mirror `schema.sql` ENUM types or CHECK constraints exactly.
 * Schema-vs-DB drift detection (M5) will fail the build if these diverge.
 */

import { z } from 'zod';

/**
 * Network family.
 *
 * Mirrors `networks.network_family CHECK (network_family IN ('evm', 'solana'))`.
 */
export const networkFamilyEnum = z.enum(['evm', 'solana']);

/**
 * Network type (full name).
 *
 * Mirrors the PostgreSQL `network_type` ENUM in schema.sql.
 */
export const networkTypeEnum = z.enum([
  'celo-alfajores',
  'celo-mainnet',
  'solana-devnet',
  'solana-mainnet',
]);

/**
 * Offer type.
 *
 * Mirrors `offers.offer_type CHECK (offer_type IN ('BUY', 'SELL'))`.
 */
export const offerTypeEnum = z.enum(['BUY', 'SELL']);

/**
 * Token symbol.
 *
 * Currently only USDC is supported (matches `DEFAULT 'USDC'` in schema.sql for
 * offers.token, escrows.token_type, trades.leg1_crypto_token, etc.).
 * Add more values here when the platform supports other tokens.
 */
export const tokenEnum = z.enum(['USDC']);

/**
 * ISO 4217 fiat currency code (3 uppercase letters).
 *
 * Mirrors `VARCHAR(3)` columns like `offers.fiat_currency`,
 * `trades.from_fiat_currency`, etc. The DB does not enforce a CHECK on
 * specific currencies, only the 3-char length.
 */
export const fiatCurrency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Fiat currency must be a 3-letter uppercase ISO code');

/**
 * Account role.
 *
 * Mirrors `accounts.role CHECK (role IN ('user', 'admin'))`.
 */
export const accountRoleEnum = z.enum(['user', 'admin']);

/**
 * Transaction status.
 *
 * Mirrors the PostgreSQL `transaction_status` ENUM:
 * `('PENDING', 'SUCCESS', 'FAILED')`.
 */
export const transactionStatusEnum = z.enum(['PENDING', 'SUCCESS', 'FAILED']);

/**
 * Transaction type.
 *
 * Mirrors the PostgreSQL `transaction_type` ENUM in schema.sql.
 */
export const transactionTypeEnum = z.enum([
  'CREATE_ESCROW',
  'FUND_ESCROW',
  'RELEASE_ESCROW',
  'CANCEL_ESCROW',
  'MARK_FIAT_PAID',
  'OPEN_DISPUTE',
  'RESPOND_DISPUTE',
  'RESOLVE_DISPUTE',
  'EVENT',
  'INITIALIZE_BUYER_BOND',
  'INITIALIZE_SELLER_BOND',
  'UPDATE_SEQUENTIAL_ADDRESS',
  'AUTO_CANCEL',
  'OTHER',
]);
