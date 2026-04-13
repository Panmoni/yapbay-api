// OpenAPI registration for offer routes. Public read, authenticated writes.

import { z } from 'zod';
import { openApiRegistry } from '../../openapi';
import {
  createOfferRequestSchema,
  createOfferResponseSchema,
  deleteOfferResponseSchema,
  getOfferResponseSchema,
  listOffersQuerySchema,
  listOffersResponseSchema,
  offerIdParamsSchema,
  updateOfferRequestSchema,
  updateOfferResponseSchema,
} from '../../schemas/offers';
import { ErrorResponse } from './shared';

const ListOffersResponse = openApiRegistry.register('ListOffersResponse', listOffersResponseSchema);
const GetOfferResponse = openApiRegistry.register('GetOfferResponse', getOfferResponseSchema);
const CreateOfferRequest = openApiRegistry.register('CreateOfferRequest', createOfferRequestSchema);
const CreateOfferResponse = openApiRegistry.register(
  'CreateOfferResponse',
  createOfferResponseSchema,
);
const UpdateOfferRequest = openApiRegistry.register('UpdateOfferRequest', updateOfferRequestSchema);
const UpdateOfferResponse = openApiRegistry.register(
  'UpdateOfferResponse',
  updateOfferResponseSchema,
);
const DeleteOfferResponse = openApiRegistry.register(
  'DeleteOfferResponse',
  deleteOfferResponseSchema,
);

const networkHeader = z.object({
  'x-network-name': z
    .string()
    .openapi({ description: 'Network identifier (e.g. solana-devnet, celo-alfajores).' }),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/offers',
  summary: 'List offers (public)',
  description: 'List offers filtered by criteria. No auth required.',
  tags: ['Offers'],
  request: {
    query: listOffersQuerySchema,
    headers: networkHeader,
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: ListOffersResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/offers/{id}',
  summary: 'Get offer by id (public)',
  tags: ['Offers'],
  request: { params: offerIdParamsSchema, headers: networkHeader },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: GetOfferResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/offers',
  summary: 'Create offer',
  description: 'Restricted to the authenticated creator account.',
  tags: ['Offers'],
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateOfferRequest } } },
    headers: networkHeader,
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: CreateOfferResponse } },
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
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/offers/{id}',
  summary: 'Update offer (owner only)',
  tags: ['Offers'],
  security: [{ bearerAuth: [] }],
  request: {
    params: offerIdParamsSchema,
    body: { content: { 'application/json': { schema: UpdateOfferRequest } } },
    headers: networkHeader,
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: UpdateOfferResponse } },
    },
    403: { description: 'Not owner', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/offers/{id}',
  summary: 'Delete offer (owner only)',
  tags: ['Offers'],
  security: [{ bearerAuth: [] }],
  request: { params: offerIdParamsSchema, headers: networkHeader },
  responses: {
    200: {
      description: 'Deleted',
      content: { 'application/json': { schema: DeleteOfferResponse } },
    },
    403: { description: 'Not owner', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});
