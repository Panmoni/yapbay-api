// Shared OpenAPI components: standard error shape, pagination, etc.
//
// Every per-group registration file should reference these instead of
// redeclaring response shapes, so the generated spec stays consistent and
// client codegen can rely on a single ErrorResponse type.

import { z } from 'zod';
import { openApiRegistry } from '../../openapi';

const errorResponse = z
  .object({
    error: z.string(),
    message: z.string().optional(),
    details: z.string().optional(),
  })
  .openapi({
    description: 'Standard error envelope.',
    example: { error: 'invalid_value', message: 'A value failed validation.' },
  });

export const ErrorResponse = openApiRegistry.register('ErrorResponse', errorResponse);

// Shared `x-network-name` header parameter. Registered so routes that
// need a canonical spec reference can use `$ref` — the existing inline
// zod-header approach on offers/escrows routes is equivalent for Swagger
// rendering and stays in place for now to avoid touching every route.
openApiRegistry.registerParameter(
  'NetworkName',
  z.string().openapi({
    param: { name: 'x-network-name', in: 'header' },
    description:
      'Target network identifier (e.g. `solana-devnet`, `celo-alfajores`). Required on chain-aware endpoints.',
    example: 'solana-devnet',
  }),
);

const paginationMeta = z
  .object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .openapi({ description: 'Page/limit/total pagination metadata.' });

export const PaginationMeta = openApiRegistry.register('PaginationMeta', paginationMeta);
