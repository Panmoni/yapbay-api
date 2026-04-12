import axios from 'axios';
import express, { type Response } from 'express';
import { logError } from '../logger';
import { withErrorHandling } from '../middleware/errorHandler';
import { handler } from '../middleware/typedHandler';
import { validate } from '../middleware/validate';
import { validateResponse } from '../middleware/validateResponse';
import { pricesRequestSchemas, pricesResponseSchema, supportedPriceFiats } from '../schemas/public';
import { sendErrorResponse } from '../utils/errorResponse';

const router = express.Router();

// /prices
router.get(
  '/prices',
  validate(pricesRequestSchemas),
  validateResponse(pricesResponseSchema),
  withErrorHandling(
    handler(pricesRequestSchemas, async (req, res: Response): Promise<void> => {
      try {
        const pricingServerUrl = process.env.PRICING_SERVER_URL;
        if (!pricingServerUrl) {
          throw new Error('PRICING_SERVER_URL not configured in .env');
        }

        const pricePromises = supportedPriceFiats.map((fiat) =>
          axios.get(`${pricingServerUrl}/price?token=USDC&fiat=${fiat}`),
        );

        const responses = await Promise.all(pricePromises);
        const prices = responses.reduce(
          (acc, response, index) => {
            const fiat = supportedPriceFiats[index];
            acc[fiat] = {
              price: response.data.data.price,
              timestamp: response.data.data.timestamp,
            };
            return acc;
          },
          {} as Record<string, { price: string; timestamp: number }>,
        );

        res.json({ status: 'success', data: { USDC: prices } });
      } catch (err) {
        const error = err as Error & {
          response?: {
            status: number;
            data: { message?: string; [key: string]: unknown };
          };
        };
        logError('Failed to fetch prices', error);
        const status = error.response?.status || 500;
        const message = error.response?.data?.message || error.message || 'Failed to fetch prices';
        sendErrorResponse(req, res, status, 'prices_unavailable', message);
      }
    }),
  ),
);

export default router;
