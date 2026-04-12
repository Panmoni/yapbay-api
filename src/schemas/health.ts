/**
 * Schemas for the `/health` endpoint.
 *
 * GET / on the health router (mounted at `/health`).
 *
 * Notes on response schema:
 *   - Date fields (createdAt, updatedAt on networks) are accepted as
 *     Date | string because validation runs BEFORE Express's JSON
 *     serialization, when Date objects are still raw.
 *   - Network status spreads `NetworkConfig` and adds health-specific extras.
 *   - The response is `z.strictObject()` — drift detected at runtime.
 */

import { z } from 'zod';
import { networkFamilyEnum, networkTypeEnum } from './primitives/enums';

/** Date that may be either a JS Date or an ISO string. */
const dateOrIsoString = z.union([z.date(), z.iso.datetime()]);

/** Empty strict query/params/body for endpoints that take no input. */
export const emptyStrictObject = z.strictObject({});

/** Health request: no params/query/body. */
export const healthRequestSchemas = {
  body: emptyStrictObject,
  params: emptyStrictObject,
  query: emptyStrictObject,
} as const;

/**
 * Network status as returned by the health endpoint.
 *
 * Spreads `NetworkConfig` shape and adds runtime status fields.
 */
const networkStatusSchema = z.strictObject({
  // NetworkConfig fields (mirror src/types/networks.ts)
  arbitratorAddress: z.string(),
  blockExplorerUrl: z.string().optional(),
  chainId: z.number().int(),
  contractAddress: z.string().optional(),
  createdAt: dateOrIsoString,
  error: z.string().nullable(),
  id: z.number().int().positive(),
  isActive: z.boolean(),
  isTestnet: z.boolean(),
  name: networkTypeEnum,
  networkFamily: networkFamilyEnum,
  programId: z.string().optional(),
  providerChainId: z.number().int().optional(),
  providerName: z.string().optional(),
  rpcUrl: z.string(),
  // Runtime status fields added by the health handler
  status: z.string(),
  updatedAt: dateOrIsoString,
  usdcMint: z.string().optional(),
  warning: z.string().optional(),
  wsUrl: z.string().nullable().optional(),
});

const dbCountsSchema = z.strictObject({
  accounts: z.number().int().nonnegative(),
  escrows: z.number().int().nonnegative(),
  offers: z.number().int().nonnegative(),
  trades: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
});

const versionInfoSchema = z.strictObject({
  buildDate: z.string(),
  gitBranch: z.string(),
  gitCommitDate: z.string(),
  gitCommitHash: z.string(),
  isDirty: z.boolean(),
  version: z.string(),
});

/**
 * Full /health response shape.
 */
export const healthResponseSchema = z.strictObject({
  apiVersion: versionInfoSchema,
  contractVersion: z.string(),
  database: z.strictObject({
    counts: dbCountsSchema,
    status: z.enum(['Connected', 'Error']),
    summary: z.strictObject({
      accounts: z.number().int().nonnegative(),
      escrows: z.number().int().nonnegative(),
      offers: z.number().int().nonnegative(),
      totalRecords: z.number().int().nonnegative(),
      trades: z.number().int().nonnegative(),
      transactions: z.number().int().nonnegative(),
    }),
  }),
  dbStatus: z.enum(['Connected', 'Error']),
  eventListeners: z.strictObject({
    activeCount: z.number().int().nonnegative(),
    healthy: z.boolean(),
  }),
  networks: z.array(networkStatusSchema),
  status: z.literal('OK'),
  summary: z.strictObject({
    activeNetworks: z.number().int().nonnegative(),
    connectedNetworks: z.number().int().nonnegative(),
    errorNetworks: z.number().int().nonnegative(),
    evmNetworks: z.number().int().nonnegative(),
    solanaNetworks: z.number().int().nonnegative(),
    totalNetworks: z.number().int().nonnegative(),
  }),
  timestamp: z.iso.datetime(),
  userWallet: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
