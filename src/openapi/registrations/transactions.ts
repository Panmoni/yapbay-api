// OpenAPI registration for transaction routes. All authenticated.
// POST /transactions/record MUST be replay-safe; Idempotency-Key required.

import { openApiRegistry } from '../../openapi';
import {
  recordTransactionRequestSchema,
  recordTransactionResponseSchema,
  transactionsByTradeResponseSchema,
  transactionsByUserResponseSchema,
  transactionTradeIdParamsSchema,
  transactionTradeQuerySchema,
  transactionUserQuerySchema,
} from '../../schemas/transactions';
import { ErrorResponse } from './shared';

const RecordTransactionRequest = openApiRegistry.register(
  'RecordTransactionRequest',
  recordTransactionRequestSchema,
);
const RecordTransactionResponse = openApiRegistry.register(
  'RecordTransactionResponse',
  recordTransactionResponseSchema,
);
const TransactionsByTradeResponse = openApiRegistry.register(
  'TransactionsByTradeResponse',
  transactionsByTradeResponseSchema,
);
const TransactionsByUserResponse = openApiRegistry.register(
  'TransactionsByUserResponse',
  transactionsByUserResponseSchema,
);

const idempotencyRef = { $ref: '#/components/parameters/IdempotencyKey' };

openApiRegistry.registerPath({
  method: 'post',
  path: '/transactions',
  summary: 'Record a blockchain transaction',
  description:
    'Records a confirmed on-chain transaction. `Idempotency-Key` header (UUID v4) is REQUIRED — this is the hottest replay-vulnerable write path and a retry without the key would create a duplicate ledger row. See the Idempotency section of docs/api-ref.md for replay semantics.',
  tags: ['Transactions'],
  security: [{ bearerAuth: [] }],
  // biome-ignore lint/suspicious/noExplicitAny: registerPath params type doesn't expose $ref cleanly
  parameters: [idempotencyRef as any],
  request: {
    body: { content: { 'application/json': { schema: RecordTransactionRequest } } },
  },
  responses: {
    201: {
      description: 'Recorded',
      content: { 'application/json': { schema: RecordTransactionResponse } },
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
  path: '/transactions/trade/{id}',
  summary: 'List transactions for a trade',
  tags: ['Transactions'],
  security: [{ bearerAuth: [] }],
  request: {
    params: transactionTradeIdParamsSchema,
    query: transactionTradeQuerySchema,
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: TransactionsByTradeResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/transactions/user',
  summary: "List authenticated user's transactions",
  tags: ['Transactions'],
  security: [{ bearerAuth: [] }],
  request: { query: transactionUserQuerySchema },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: TransactionsByUserResponse } },
    },
  },
});
