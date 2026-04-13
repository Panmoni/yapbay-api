// OpenAPI registration for escrow routes. All authenticated. Mutating
// endpoints accept Idempotency-Key; GET balance endpoints are cheap read-only.

import { z } from 'zod';
import { openApiRegistry } from '../../openapi';
import {
  escrowAutoCancelResponseSchema,
  escrowBalanceResponseSchema,
  escrowCalculatedBalanceResponseSchema,
  escrowRecordResponseSchema,
  escrowSequentialInfoResponseSchema,
  escrowStoredBalanceResponseSchema,
  listMyEscrowsQuerySchema,
  listMyEscrowsResponseSchema,
  onchainEscrowIdParamsSchema,
} from '../../schemas/escrows';
import { ErrorResponse } from './shared';

// Record requests accept one of two shapes (EVM/Solana) — register a
// permissive surrogate for now and tighten later once EVM re-enables.
const escrowRecordRequest = z.object({
  transaction_hash: z.string().optional(),
  signature: z.string().optional(),
  onchain_escrow_id: z.string(),
  metadata: z.unknown().optional(),
});
const EscrowRecordRequest = openApiRegistry.register('EscrowRecordRequest', escrowRecordRequest);
const EscrowRecordResponse = openApiRegistry.register(
  'EscrowRecordResponse',
  escrowRecordResponseSchema,
);
const ListMyEscrowsResponse = openApiRegistry.register(
  'ListMyEscrowsResponse',
  listMyEscrowsResponseSchema,
);
const EscrowBalanceResponse = openApiRegistry.register(
  'EscrowBalanceResponse',
  escrowBalanceResponseSchema,
);
const EscrowStoredBalanceResponse = openApiRegistry.register(
  'EscrowStoredBalanceResponse',
  escrowStoredBalanceResponseSchema,
);
const EscrowCalculatedBalanceResponse = openApiRegistry.register(
  'EscrowCalculatedBalanceResponse',
  escrowCalculatedBalanceResponseSchema,
);
const EscrowSequentialInfoResponse = openApiRegistry.register(
  'EscrowSequentialInfoResponse',
  escrowSequentialInfoResponseSchema,
);
const EscrowAutoCancelResponse = openApiRegistry.register(
  'EscrowAutoCancelResponse',
  escrowAutoCancelResponseSchema,
);

const idempotencyRef = { $ref: '#/components/parameters/IdempotencyKey' };
const networkHeader = z.object({
  'x-network-name': z.string().openapi({ description: 'Target network (e.g. solana-devnet).' }),
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/escrows/record',
  summary: 'Record an escrow creation event',
  description:
    'Notifies the API of an escrow created on-chain. `Idempotency-Key` header (UUID v4) is REQUIRED — double-recording an escrow creates ledger drift. See the Idempotency section of docs/api-ref.md for replay semantics.',
  tags: ['Escrows'],
  security: [{ bearerAuth: [] }],
  // biome-ignore lint/suspicious/noExplicitAny: registerPath params type doesn't expose $ref cleanly
  parameters: [idempotencyRef as any],
  request: {
    body: { content: { 'application/json': { schema: EscrowRecordRequest } } },
    headers: networkHeader,
  },
  responses: {
    201: {
      description: 'Recorded',
      content: { 'application/json': { schema: EscrowRecordResponse } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    409: {
      description: 'Idempotency-Key conflict',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/escrows/my',
  summary: 'List my escrows',
  tags: ['Escrows'],
  security: [{ bearerAuth: [] }],
  request: { query: listMyEscrowsQuerySchema, headers: networkHeader },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: ListMyEscrowsResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/escrows/{onchainEscrowId}/balance',
  summary: 'Get on-chain balance for an escrow',
  description: 'Fetches the current balance directly from the chain via RPC.',
  tags: ['Escrows'],
  security: [{ bearerAuth: [] }],
  request: { params: onchainEscrowIdParamsSchema, headers: networkHeader },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: EscrowBalanceResponse } } },
    503: {
      description: 'RPC unavailable (breaker open)',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/escrows/{onchainEscrowId}/stored-balance',
  summary: 'Get cached balance from DB',
  tags: ['Escrows'],
  security: [{ bearerAuth: [] }],
  request: { params: onchainEscrowIdParamsSchema, headers: networkHeader },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: EscrowStoredBalanceResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/escrows/{onchainEscrowId}/calculated-balance',
  summary: 'Calculated balance (stored + adjustments)',
  tags: ['Escrows'],
  security: [{ bearerAuth: [] }],
  request: { params: onchainEscrowIdParamsSchema, headers: networkHeader },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: EscrowCalculatedBalanceResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/escrows/{onchainEscrowId}/sequential-info',
  summary: 'Sequential escrow chain info',
  tags: ['Escrows'],
  security: [{ bearerAuth: [] }],
  request: { params: onchainEscrowIdParamsSchema, headers: networkHeader },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: EscrowSequentialInfoResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/escrows/{onchainEscrowId}/auto-cancel-eligible',
  summary: 'Check auto-cancel eligibility',
  tags: ['Escrows'],
  security: [{ bearerAuth: [] }],
  request: { params: onchainEscrowIdParamsSchema, headers: networkHeader },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: EscrowAutoCancelResponse } },
    },
  },
});
