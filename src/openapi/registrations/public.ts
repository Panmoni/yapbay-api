// OpenAPI registration for public routes (no auth).

import { z } from 'zod';
import { openApiRegistry } from '../../openapi';
import { ErrorResponse } from './shared';

const fiatPrice = z.object({
  price: z.string(),
  timestamp: z.number().int().positive(),
});

const pricesResponse = z
  .object({
    status: z.literal('success'),
    data: z.object({
      USDC: z.record(z.string(), fiatPrice),
    }),
  })
  .openapi({
    description: 'Current USDC prices in supported fiat currencies.',
    example: {
      status: 'success',
      data: { USDC: { USD: { price: '1.00', timestamp: 1_700_000_000 } } },
    },
  });

const PricesResponse = openApiRegistry.register('PricesResponse', pricesResponse);

openApiRegistry.registerPath({
  method: 'get',
  path: '/prices',
  summary: 'USDC fiat prices',
  description: 'Returns current USDC prices in supported fiat currencies. Public endpoint.',
  tags: ['Public'],
  request: {
    query: z.object({
      fiat: z.string().optional().openapi({ description: 'Filter to a single fiat code.' }),
    }),
  },
  responses: {
    200: {
      description: 'Prices fetched',
      content: { 'application/json': { schema: PricesResponse } },
    },
    500: {
      description: 'Pricing service unavailable',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
