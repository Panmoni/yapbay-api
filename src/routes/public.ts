import express, { Request, Response } from 'express';
import axios from 'axios';
import { withErrorHandling } from '../middleware/errorHandler';
import { logError } from '../logger';

const router = express.Router();

// /prices
router.get(
  '/prices',
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    try {
      const pricingServerUrl = process.env.PRICING_SERVER_URL;
      if (!pricingServerUrl) {
        throw new Error('PRICING_SERVER_URL not configured in .env');
      }

      const fiats = ['USD', 'COP', 'EUR', 'NGN', 'VES'];
      const pricePromises = fiats.map(fiat =>
        axios.get(`${pricingServerUrl}/price?token=USDC&fiat=${fiat}`)
      );

      const responses = await Promise.all(pricePromises);
      const prices = responses.reduce((acc, response, index) => {
        const fiat = fiats[index];
        acc[fiat] = {
          price: response.data.data.price,
          timestamp: response.data.data.timestamp,
        };
        return acc;
      }, {} as Record<string, { price: string; timestamp: number }>);

      res.json({ status: 'success', data: { USDC: prices } });
    } catch (err) {
      const error = err as Error & {
        response?: {
          status: number;
          data: { message?: string; [key: string]: unknown };
        };
      };
      logError('Failed to fetch prices', error);
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || error.message || 'Failed to fetch prices',
      });
    }
  })
);

export default router;