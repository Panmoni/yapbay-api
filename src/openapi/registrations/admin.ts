// OpenAPI registration for admin routes. All require bearerAuth.

import { z } from 'zod';
import { openApiRegistry } from '../../openapi';
import { ErrorResponse, PaginationMeta } from './shared';

// Admin response shapes are pinned to known columns so the public spec
// doesn't silently leak future `trades`/`escrows` schema additions. Keep in
// sync with schema.sql — the lint-level drift is acceptable here because
// the generator runs at build time and a shape mismatch surfaces as a
// missing-field assertion at the route handler, not at runtime for clients.
const tradeRow = z
  .object({
    id: z.number().int(),
    leg1_offer_id: z.number().int().nullable(),
    leg2_offer_id: z.number().int().nullable(),
    overall_status: z.string(),
    from_fiat_currency: z.string(),
    destination_fiat_currency: z.string(),
    from_bank: z.string().nullable(),
    destination_bank: z.string().nullable(),
    leg1_state: z.string().nullable(),
    leg2_state: z.string().nullable(),
    leg1_seller_account_id: z.number().int().nullable(),
    leg1_buyer_account_id: z.number().int().nullable(),
    leg2_seller_account_id: z.number().int().nullable(),
    leg2_buyer_account_id: z.number().int().nullable(),
    leg1_crypto_amount: z.string().nullable(),
    leg2_crypto_amount: z.string().nullable(),
    leg1_crypto_token: z.string().nullable(),
    leg2_crypto_token: z.string().nullable(),
    leg1_fiat_amount: z.string().nullable(),
    leg2_fiat_amount: z.string().nullable(),
    completed: z.boolean().nullable(),
    completed_at: z.string().datetime().nullable(),
    cancelled: z.boolean().nullable(),
    cancelled_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi({ description: 'Trade row as stored in the trades table.' });
const adminTradesResponse = z.object({
  data: z.array(tradeRow),
  meta: PaginationMeta,
});
const AdminTradesResponse = openApiRegistry.register('AdminTradesResponse', adminTradesResponse);

openApiRegistry.registerPath({
  method: 'get',
  path: '/admin/trades',
  summary: 'List all trades (admin)',
  description: 'Paginated list of every trade. Admin-only.',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(200).default(50),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: AdminTradesResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'Forbidden (non-admin)',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

const escrowRow = z
  .object({
    id: z.number().int(),
    trade_id: z.number().int().nullable(),
    network_id: z.number().int(),
    onchain_escrow_id: z.string().nullable(),
    state: z.string(),
    current_balance: z.string().nullable(),
    seller_address: z.string().nullable(),
    buyer_address: z.string().nullable(),
    arbitrator_address: z.string().nullable(),
    amount: z.string().nullable(),
    token_type: z.string().nullable(),
    deposit_deadline: z.string().datetime().nullable(),
    fiat_deadline: z.string().datetime().nullable(),
    fiat_paid: z.boolean().nullable(),
    completed_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi({ description: 'Escrow row as stored in the escrows table.' });
const adminEscrowsResponse = z.object({ data: z.array(escrowRow), meta: PaginationMeta });
const AdminEscrowsResponse = openApiRegistry.register('AdminEscrowsResponse', adminEscrowsResponse);

openApiRegistry.registerPath({
  method: 'get',
  path: '/admin/escrows/{trade_id}',
  summary: 'Get escrow by trade id (admin)',
  description: 'Fetch the escrow row for a given trade. Admin-only.',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ trade_id: z.coerce.number().int().positive() }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: AdminEscrowsResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } },
    404: {
      description: 'Escrow not found',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

const deadlineStatsResponse = z.object({
  success: z.boolean(),
  data: z.unknown(),
  timestamp: z.string().datetime(),
});
const DeadlineStatsResponse = openApiRegistry.register(
  'DeadlineStatsResponse',
  deadlineStatsResponse,
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/admin/deadline-stats',
  summary: 'Deadline stats across networks',
  description: 'Aggregate deadline expiry statistics across every network.',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: DeadlineStatsResponse } },
    },
    500: {
      description: 'Failed to fetch',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/admin/deadline-stats/{networkId}',
  summary: 'Deadline stats for a single network',
  description: 'Deadline expiry statistics for a specific network.',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ networkId: z.coerce.number().int().positive() }),
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: DeadlineStatsResponse } },
    },
    404: {
      description: 'Network not found',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
