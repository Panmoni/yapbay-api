import express, { type Response } from 'express';
import { query } from '../../db';
import { restrictToOwner } from '../../middleware';
import { withErrorHandling } from '../../middleware/errorHandler';
import { requireNetwork } from '../../middleware/networkMiddleware';
import { handler } from '../../middleware/typedHandler';
import { validate } from '../../middleware/validate';
import { validateResponse } from '../../middleware/validateResponse';
import {
  createOfferRequestSchema,
  createOfferResponseSchema,
  deleteOfferResponseSchema,
  offerIdParamsSchema,
  updateOfferRequestSchema,
  updateOfferResponseSchema,
} from '../../schemas/offers';
import { sendNetworkResponse } from '../../utils/routeHelpers';
import { validateOfferCreationBusiness } from './businessValidation';

const router = express.Router();

const createSchemas = { body: createOfferRequestSchema } as const;

// Create a new offer (restricted to creator's account)
router.post(
  '/',
  requireNetwork,
  validate({ body: createOfferRequestSchema }),
  validateOfferCreationBusiness,
  validateResponse(createOfferResponseSchema),
  withErrorHandling(
    handler(createSchemas, async (req, res: Response): Promise<void> => {
      const { creator_account_id, offer_type, min_amount, fiat_currency } = req.body;
      const networkId = req.networkId!;

      const result = await query(
        'INSERT INTO offers (creator_account_id, offer_type, token, fiat_currency, min_amount, max_amount, total_available_amount, rate_adjustment, terms, escrow_deposit_time_limit, fiat_payment_time_limit, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
        [
          creator_account_id,
          offer_type,
          req.body.token || 'USDC',
          fiat_currency,
          min_amount,
          req.body.max_amount || min_amount,
          req.body.total_available_amount || min_amount,
          req.body.rate_adjustment || 1.05,
          req.body.terms || 'Cash only',
          req.body.escrow_deposit_time_limit || '15 minutes',
          req.body.fiat_payment_time_limit || '30 minutes',
          networkId,
        ],
      );
      res.status(201).json({
        network: req.network!.name,
        offer: result[0],
      });
    }),
  ),
);

const updateSchemas = { body: updateOfferRequestSchema, params: offerIdParamsSchema } as const;

// Update an offer (restricted to creator)
router.put(
  '/:id',
  requireNetwork,
  validate({ body: updateOfferRequestSchema, params: offerIdParamsSchema }),
  restrictToOwner('offer', 'id'),
  validateResponse(updateOfferResponseSchema),
  withErrorHandling(
    handler(updateSchemas, async (req, res: Response): Promise<void> => {
      const { id } = req.params;
      const networkId = req.networkId!;
      try {
        const {
          min_amount,
          max_amount,
          total_available_amount,
          rate_adjustment,
          terms,
          escrow_deposit_time_limit,
          fiat_payment_time_limit,
          fiat_currency,
          offer_type,
          token,
        } = req.body;

        const formatTimeLimit = (
          limit: undefined | null | string | { minutes: number },
        ): string | null => {
          if (!limit) {
            return null;
          }
          if (typeof limit === 'string') {
            return limit;
          }
          if (limit.minutes) {
            return `${limit.minutes} minutes`;
          }
          return null;
        };

        const result = await query(
          `UPDATE offers SET
          min_amount = COALESCE($1, min_amount),
          max_amount = COALESCE($2, max_amount),
          total_available_amount = COALESCE($3, total_available_amount),
          rate_adjustment = COALESCE($4, rate_adjustment),
          terms = COALESCE($5, terms),
          escrow_deposit_time_limit = COALESCE($6::interval, escrow_deposit_time_limit),
          fiat_payment_time_limit = COALESCE($7::interval, fiat_payment_time_limit),
          fiat_currency = COALESCE($8, fiat_currency),
          offer_type = COALESCE($9, offer_type),
          token = COALESCE($10, token),
          updated_at = NOW()
        WHERE id = $11 AND network_id = $12 RETURNING *`,
          [
            min_amount || null,
            max_amount || null,
            total_available_amount || null,
            rate_adjustment || null,
            terms || null,
            formatTimeLimit(escrow_deposit_time_limit),
            formatTimeLimit(fiat_payment_time_limit),
            fiat_currency || null,
            offer_type || null,
            token || null,
            id,
            networkId,
          ],
        );

        if (result.length === 0) {
          res.status(404).json({ error: 'Offer not found' });
          return;
        }

        sendNetworkResponse(res, result[0], req.network!.name, 'offer');
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    }),
  ),
);

const deleteSchemas = { params: offerIdParamsSchema } as const;

// Delete an offer (restricted to creator)
router.delete(
  '/:id',
  requireNetwork,
  validate({ params: offerIdParamsSchema }),
  restrictToOwner('offer', 'id'),
  validateResponse(deleteOfferResponseSchema),
  withErrorHandling(
    handler(deleteSchemas, async (req, res: Response): Promise<void> => {
      const { id } = req.params;
      const networkId = req.networkId!;
      try {
        const offerCheck = await query('SELECT id FROM offers WHERE id = $1 AND network_id = $2', [
          id,
          networkId,
        ]);
        if (offerCheck.length === 0) {
          res.status(404).json({ error: 'Offer not found' });
          return;
        }

        const activeTrades = await query(
          "SELECT id FROM trades WHERE leg1_offer_id = $1 AND network_id = $2 AND overall_status NOT IN ('COMPLETED', 'CANCELLED')",
          [id, networkId],
        );

        if (activeTrades.length > 0) {
          res.status(400).json({
            error: `Cannot delete - ${activeTrades.length} active trades exist`,
            active_trades: activeTrades.length,
          });
          return;
        }

        const result = await query(
          'DELETE FROM offers WHERE id = $1 AND network_id = $2 RETURNING id',
          [id, networkId],
        );

        if (result.length === 0) {
          res.status(500).json({ error: 'Unexpected error deleting offer' });
          return;
        }

        res.json({ message: 'Offer deleted' });
      } catch (err) {
        const error = err as Error & { code?: string };

        if (error.code === '23503') {
          res.status(400).json({
            error: 'Cannot delete offer - it is referenced by other records',
            details: error.message,
          });
        } else {
          res.status(500).json({
            error: 'Internal server error',
            details: error.message,
          });
        }
      }
    }),
  ),
);

export default router;
