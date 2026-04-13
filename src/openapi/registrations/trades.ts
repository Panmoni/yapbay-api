// OpenAPI registration for trade routes. All authenticated. Mutating
// endpoints accept Idempotency-Key for retry safety.

import { openApiRegistry } from '../../openapi';
import {
  createTradeRequestSchema,
  createTradeResponseSchema,
  getTradeResponseSchema,
  listMyTradesQuerySchema,
  listMyTradesResponseSchema,
  tradeIdParamsSchema,
  tradeUpdateResponseSchema,
  updateTradeRequestSchema,
} from '../../schemas/trades';
import { ErrorResponse } from './shared';

const CreateTradeRequest = openApiRegistry.register('CreateTradeRequest', createTradeRequestSchema);
const CreateTradeResponse = openApiRegistry.register(
  'CreateTradeResponse',
  createTradeResponseSchema,
);
const GetTradeResponse = openApiRegistry.register('GetTradeResponse', getTradeResponseSchema);
const ListMyTradesResponse = openApiRegistry.register(
  'ListMyTradesResponse',
  listMyTradesResponseSchema,
);
const UpdateTradeRequest = openApiRegistry.register('UpdateTradeRequest', updateTradeRequestSchema);
const TradeUpdateResponse = openApiRegistry.register(
  'TradeUpdateResponse',
  tradeUpdateResponseSchema,
);

const idempotencyRef = { $ref: '#/components/parameters/IdempotencyKey' };

openApiRegistry.registerPath({
  method: 'post',
  path: '/trades',
  summary: 'Create trade',
  description:
    'Create a trade against an existing offer. Accepts Idempotency-Key for retry-safe creation.',
  tags: ['Trades'],
  security: [{ bearerAuth: [] }],
  // biome-ignore lint/suspicious/noExplicitAny: registerPath params type doesn't expose $ref cleanly
  parameters: [idempotencyRef as any],
  request: { body: { content: { 'application/json': { schema: CreateTradeRequest } } } },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: CreateTradeResponse } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    409: {
      description: 'Idempotency-Key conflict (different body replayed with same key)',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/trades/my',
  summary: 'List my trades',
  description: 'Returns trades where the authenticated user is a participant.',
  tags: ['Trades'],
  security: [{ bearerAuth: [] }],
  request: { query: listMyTradesQuerySchema },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: ListMyTradesResponse } } },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/trades/{id}',
  summary: 'Get trade by id',
  tags: ['Trades'],
  security: [{ bearerAuth: [] }],
  request: { params: tradeIdParamsSchema },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: GetTradeResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/trades/{id}',
  summary: 'Update trade (state transition)',
  description:
    'Transitions the trade state (e.g. MARK_FIAT_PAID). Idempotency-Key recommended — a retry after network failure must not re-mark fiat paid.',
  tags: ['Trades'],
  security: [{ bearerAuth: [] }],
  // biome-ignore lint/suspicious/noExplicitAny: registerPath params type doesn't expose $ref cleanly
  parameters: [idempotencyRef as any],
  request: {
    params: tradeIdParamsSchema,
    body: { content: { 'application/json': { schema: UpdateTradeRequest } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: TradeUpdateResponse } },
    },
    400: {
      description: 'Invalid state transition',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    409: {
      description: 'Idempotency-Key conflict or finalized resource',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
