/**
 * Schemas for the public (no-auth) routes.
 *
 * Currently: GET /prices.
 */

import { z } from 'zod';
import { emptyStrictObject } from './health';

/**
 * Per-fiat price entry returned by the upstream pricing service.
 */
const priceEntrySchema = z.strictObject({
  price: z.string(),
  timestamp: z.number(),
});

/**
 * Set of fiat currencies the /prices endpoint queries upstream.
 *
 * Mirrors the hardcoded `fiats` array in src/routes/public.ts. Adding a fiat
 * here without adding it there (or vice versa) is a drift that the response
 * schema will catch at runtime.
 */
export const supportedPriceFiats = ['USD', 'COP', 'EUR', 'NGN', 'VES'] as const;

const usdcPricesSchema = z.strictObject({
  COP: priceEntrySchema,
  EUR: priceEntrySchema,
  NGN: priceEntrySchema,
  USD: priceEntrySchema,
  VES: priceEntrySchema,
});

/** GET /prices request: no params/query/body. */
export const pricesRequestSchemas = {
  body: emptyStrictObject,
  params: emptyStrictObject,
  query: emptyStrictObject,
} as const;

/** GET /prices response shape. */
export const pricesResponseSchema = z.strictObject({
  data: z.strictObject({
    USDC: usdcPricesSchema,
  }),
  status: z.literal('success'),
});

export type PricesResponse = z.infer<typeof pricesResponseSchema>;
