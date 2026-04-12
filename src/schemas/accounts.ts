/**
 * Schemas for the `/accounts` routes.
 *
 * Mirrors `schema.sql` `accounts` table:
 *   - wallet_address VARCHAR(44) UNIQUE NOT NULL
 *   - username VARCHAR(50) UNIQUE NOT NULL
 *   - email VARCHAR(100) UNIQUE NOT NULL
 *   - telegram_username VARCHAR(50)
 *   - telegram_id BIGINT
 *   - profile_photo_url TEXT
 *   - phone_country_code VARCHAR(5)
 *   - phone_number VARCHAR(15)
 *   - available_from TIME
 *   - available_to TIME
 *   - timezone VARCHAR(50)
 *   - role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin'))
 *   - created_at TIMESTAMP WITH TIME ZONE NOT NULL
 *   - updated_at TIMESTAMP WITH TIME ZONE NOT NULL
 */

import { z } from 'zod';
import { evmAddress, solanaAddress } from './primitives/addresses';
import { accountRoleEnum } from './primitives/enums';
import { dbIdParam } from './primitives/ids';

// ---------------------------------------------------------------------------
// Shared field definitions
// ---------------------------------------------------------------------------

/** Date that may be either a JS Date or an ISO string (pg returns Date objects). */
const dateOrIsoString = z.union([z.date(), z.string()]);

/**
 * Wallet address that accepts either EVM (0x…) or Solana (base58) format.
 *
 * Accounts don't have a network_family column — the same account row holds
 * whichever address type the user registered with.
 */
const walletAddress = z.union([evmAddress, solanaAddress]);

/**
 * TIME columns come back from pg as strings like "09:00:00" or "14:30:00+00".
 * Loose regex: HH:MM:SS with optional timezone offset.
 */
const timeString = z.string().regex(/^\d{2}:\d{2}:\d{2}/, 'Must be a TIME string (HH:MM:SS)');

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/**
 * POST /accounts — create a new account.
 *
 * Only requires the three NOT NULL columns. Everything else has a DB default
 * or is nullable.
 */
export const createAccountRequestSchema = z.strictObject({
  email: z.string().email('Must be a valid email').max(100),
  username: z.string().min(1, 'Username is required').max(50, 'Username max 50 chars'),
  wallet_address: walletAddress,
});

/**
 * PUT /accounts/:id — update an existing account.
 *
 * All fields are optional. Only supplied fields are updated (handler uses
 * COALESCE).
 */
export const updateAccountRequestSchema = z.strictObject({
  available_from: z.string().optional(),
  available_to: z.string().optional(),
  email: z.string().email('Must be a valid email').max(100).optional(),
  phone_country_code: z.string().max(5).optional(),
  phone_number: z.string().max(15).optional(),
  profile_photo_url: z.string().url('Must be a valid URL').optional(),
  telegram_id: z.number().int().optional(),
  telegram_username: z.string().max(50).optional(),
  timezone: z.string().max(50).optional(),
  username: z.string().min(1).max(50, 'Username max 50 chars').optional(),
});

/** URL params for /accounts/:id. */
export const accountIdParamsSchema = z.strictObject({
  id: dbIdParam,
});

/** GET /accounts/me and GET /accounts/:id — no body/query needed. */
export const emptyBodyQuery = {
  body: z.strictObject({}),
  query: z.strictObject({}),
} as const;

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/**
 * Full account record returned by `SELECT *` (GET /accounts/me).
 *
 * Every column from the `accounts` table.
 */
export const accountFullResponseSchema = z.strictObject({
  available_from: timeString.nullable(),
  available_to: timeString.nullable(),
  created_at: dateOrIsoString,
  email: z.string(),
  id: z.number().int().positive(),
  phone_country_code: z.string().nullable(),
  phone_number: z.string().nullable(),
  profile_photo_url: z.string().nullable(),
  role: accountRoleEnum,
  telegram_id: z.union([z.string(), z.number()]).nullable(),
  telegram_username: z.string().nullable(),
  timezone: z.string().nullable(),
  updated_at: dateOrIsoString,
  username: z.string(),
  wallet_address: z.string(),
});

/**
 * Public profile returned to non-owners (GET /accounts/:id).
 *
 * Excludes email, phone_country_code, phone_number, role, updated_at.
 */
export const accountPublicResponseSchema = z.strictObject({
  available_from: timeString.nullable(),
  available_to: timeString.nullable(),
  created_at: dateOrIsoString,
  id: z.number().int().positive(),
  profile_photo_url: z.string().nullable(),
  telegram_id: z.union([z.string(), z.number()]).nullable(),
  telegram_username: z.string().nullable(),
  timezone: z.string().nullable(),
  username: z.string(),
  wallet_address: z.string(),
});

/** GET /accounts/:id returns either full (owner) or public (non-owner). */
export const accountGetByIdResponseSchema = z.union([
  accountFullResponseSchema,
  accountPublicResponseSchema,
]);

/** POST /accounts and PUT /accounts/:id response: just the ID. */
export const accountMutationResponseSchema = z.strictObject({
  id: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;
export type UpdateAccountRequest = z.infer<typeof updateAccountRequestSchema>;
export type AccountFullResponse = z.infer<typeof accountFullResponseSchema>;
export type AccountPublicResponse = z.infer<typeof accountPublicResponseSchema>;
