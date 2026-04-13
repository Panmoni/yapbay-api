// OpenAPI registration for accounts routes. Authenticated.

import { openApiRegistry } from '../../openapi';
import {
  accountFullResponseSchema,
  accountGetByIdResponseSchema,
  accountIdParamsSchema,
  accountMutationResponseSchema,
  createAccountRequestSchema,
  updateAccountRequestSchema,
} from '../../schemas/accounts';
import { ErrorResponse } from './shared';

const CreateAccountRequest = openApiRegistry.register(
  'CreateAccountRequest',
  createAccountRequestSchema,
);
const UpdateAccountRequest = openApiRegistry.register(
  'UpdateAccountRequest',
  updateAccountRequestSchema,
);
const AccountMutationResponse = openApiRegistry.register(
  'AccountMutationResponse',
  accountMutationResponseSchema,
);
const AccountFullResponse = openApiRegistry.register(
  'AccountFullResponse',
  accountFullResponseSchema,
);
const AccountGetByIdResponse = openApiRegistry.register(
  'AccountGetByIdResponse',
  accountGetByIdResponseSchema,
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/accounts',
  summary: 'Create account',
  description: 'Create an account linked to the authenticated wallet.',
  tags: ['Accounts'],
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateAccountRequest } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: AccountMutationResponse } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    409: {
      description: 'Account already exists',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/accounts/me',
  summary: 'Get my account',
  description: "Returns the authenticated wallet's account record.",
  tags: ['Accounts'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: AccountFullResponse } } },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/accounts/{id}',
  summary: 'Get account by id',
  tags: ['Accounts'],
  security: [{ bearerAuth: [] }],
  request: { params: accountIdParamsSchema },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: AccountGetByIdResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/accounts/{id}',
  summary: 'Update account (owner only)',
  tags: ['Accounts'],
  security: [{ bearerAuth: [] }],
  request: {
    params: accountIdParamsSchema,
    body: { content: { 'application/json': { schema: UpdateAccountRequest } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: AccountMutationResponse } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: { description: 'Not owner', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});
