import express, { type Response } from 'express';
import { decimalMath, query, withTransaction } from '../../db';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { withErrorHandling } from '../../middleware/errorHandler';
import { requireNetwork } from '../../middleware/networkMiddleware';
import { isDevMode } from '../../utils/envConfig';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { handleConditionalRequest, sendNetworkResponse } from '../../utils/routeHelpers';
import { requireTradeParticipant, requireTradeParticipantForUpdate } from './middleware';
import { validateTradeCreation, validateTradeUpdate } from './validation';

const router = express.Router();

// Initiate a trade (requires JWT but no ownership check yet—open to any authenticated user)
router.post(
  '/',
  requireNetwork,
  validateTradeCreation,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (isDevMode) {
      console.log('POST /trades - Request body:', JSON.stringify(req.body));
    }
    const {
      leg1_offer_id,
      leg2_offer_id,
      leg1_crypto_amount,
      leg1_fiat_amount,
      from_fiat_currency,
      destination_fiat_currency,
      from_bank,
      destination_bank,
    } = req.body;
    const networkId = req.networkId!;

    const buyerAccount = req.validatedBuyerAccount as Record<string, unknown>;
    const creatorAccount = req.validatedCreatorAccount as Record<string, unknown>;

    // Wrap entire trade creation + offer update in a single transaction
    const result = await withTransaction(async (client) => {
      // Lock the offer row to prevent concurrent depletion
      const offerRows = await client.query(
        'SELECT * FROM offers WHERE id = $1 AND network_id = $2 FOR UPDATE',
        [leg1_offer_id, networkId],
      );

      if (offerRows.rows.length === 0) {
        throw Object.assign(new Error('Offer not found or locked'), { statusCode: 404 });
      }

      const leg1Offer = offerRows.rows[0];

      // Use safe decimal math instead of parseFloat
      const amountStr =
        leg1_crypto_amount == null
          ? decimalMath.parse(leg1Offer.min_amount)
          : decimalMath.parse(leg1_crypto_amount);

      if (amountStr === null) {
        throw Object.assign(new Error('Invalid crypto amount'), { statusCode: 400 });
      }

      const newTotalAvailable = decimalMath.subtract(leg1Offer.total_available_amount, amountStr);
      const maxAmountStr = String(leg1Offer.max_amount);
      const minAmountStr = String(leg1Offer.min_amount);

      if (decimalMath.compare(newTotalAvailable, '0') < 0) {
        throw Object.assign(new Error('Insufficient available amount for this trade'), {
          statusCode: 400,
        });
      }

      const isSeller = leg1Offer.offer_type === 'SELL';
      const leg1SellerAccountId = isSeller ? Number(creatorAccount.id) : Number(buyerAccount.id);
      const leg1BuyerAccountId = isSeller ? Number(buyerAccount.id) : Number(creatorAccount.id);

      // Insert trade within the same transaction
      const tradeResult = await client.query(
        `INSERT INTO trades (
        leg1_offer_id, leg2_offer_id, overall_status, from_fiat_currency, destination_fiat_currency, from_bank, destination_bank,
        leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_token, leg1_crypto_amount, leg1_fiat_currency, leg1_fiat_amount,
        leg1_escrow_deposit_deadline, leg1_fiat_payment_deadline, network_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        NOW() + $15::interval, NOW() + $16::interval, $17
      ) RETURNING *`,
        [
          leg1_offer_id,
          leg2_offer_id || null,
          'IN_PROGRESS',
          from_fiat_currency || String(leg1Offer.fiat_currency),
          destination_fiat_currency || String(leg1Offer.fiat_currency),
          from_bank || null,
          destination_bank || null,
          'CREATED',
          leg1SellerAccountId,
          leg1BuyerAccountId,
          String(leg1Offer.token),
          amountStr,
          String(leg1Offer.fiat_currency),
          leg1_fiat_amount || null,
          leg1Offer.escrow_deposit_time_limit,
          leg1Offer.fiat_payment_time_limit,
          networkId,
        ],
      );

      // Update offer available amount within the same transaction
      if (decimalMath.compare(newTotalAvailable, maxAmountStr) < 0) {
        if (decimalMath.compare(newTotalAvailable, minAmountStr) < 0) {
          await client.query(
            'UPDATE offers SET total_available_amount = $1, max_amount = $1, min_amount = $1 WHERE id = $2',
            [newTotalAvailable, leg1_offer_id],
          );
        } else {
          await client.query(
            'UPDATE offers SET total_available_amount = $1, max_amount = $1 WHERE id = $2',
            [newTotalAvailable, leg1_offer_id],
          );
        }
      } else {
        await client.query('UPDATE offers SET total_available_amount = $1 WHERE id = $2', [
          newTotalAvailable,
          leg1_offer_id,
        ]);
      }

      return tradeResult.rows[0];
    });

    res.status(201).json({
      network: req.network!.name,
      trade: result,
    });
  }),
);

// List trades for authenticated user
router.get(
  '/my',
  requireNetwork,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    const networkId = req.networkId!;
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 100);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    if (!jwtWalletAddress) {
      res.status(404).json({ error: 'Wallet address not found in token' });
      return;
    }
    const result = await query(
      'SELECT t.* FROM trades t JOIN accounts a ON t.leg1_seller_account_id = a.id OR t.leg1_buyer_account_id = a.id WHERE LOWER(a.wallet_address) = LOWER($1) AND t.network_id = $2 ORDER BY t.created_at DESC LIMIT $3 OFFSET $4',
      [jwtWalletAddress, networkId, limit, offset],
    );

    // Find the most recently updated trade
    const lastModifiedTime =
      result.length > 0
        ? Math.max(...result.map((trade) => trade.updated_at?.getTime() || 0))
        : Date.now();
    const lastModified = new Date(lastModifiedTime);

    // Check for conditional requests
    if (handleConditionalRequest(req, res, lastModified, result)) {
      return; // 304 Not Modified was sent
    }

    sendNetworkResponse(res, result, req.network!.name, 'trades');
  }),
);

// Get trade details (restricted to participants)
router.get(
  '/:id',
  requireNetwork,
  requireTradeParticipant,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const tradeData = req.tradeData as Record<string, unknown>;

    // Get the last modified timestamp
    const lastModified = new Date(String(tradeData.updated_at) || Date.now());

    // Check for conditional requests
    if (handleConditionalRequest(req, res, lastModified, tradeData)) {
      return; // 304 Not Modified was sent
    }

    sendNetworkResponse(res, tradeData, req.network!.name, 'trade');
  }),
);

// Update trade info (restricted to trade participants)
router.put(
  '/:id',
  requireNetwork,
  requireTradeParticipantForUpdate,
  validateTradeUpdate,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const { leg1_state, overall_status, fiat_paid } = req.body;

    if (fiat_paid === true) {
      await query(
        'UPDATE trades SET leg1_fiat_paid_at = NOW() WHERE id = $1 AND leg1_fiat_paid_at IS NULL',
        [id],
      );
    } else if (fiat_paid === false) {
      await query('UPDATE trades SET leg1_fiat_paid_at = NULL WHERE id = $1', [id]);
    }

    const updateFields: string[] = [];
    const updateParams: unknown[] = [];
    let paramIndex = 1;

    if (leg1_state !== undefined) {
      updateFields.push(`leg1_state = $${paramIndex++}`);
      updateParams.push(leg1_state);

      // If setting leg1_state to CANCELLED, also set cancelled = TRUE
      if (leg1_state === 'CANCELLED') {
        updateFields.push('cancelled = TRUE');
      }
    }
    if (overall_status !== undefined) {
      updateFields.push(`overall_status = $${paramIndex++}`);
      updateParams.push(overall_status);

      // If setting overall_status to CANCELLED, also set cancelled = TRUE
      if (overall_status === 'CANCELLED') {
        updateFields.push('cancelled = TRUE');
      }
    }

    if (updateFields.length > 0) {
      updateParams.push(id);
      const sql = `UPDATE trades SET ${updateFields.join(
        ', ',
      )} WHERE id = $${paramIndex} RETURNING id`;
      const result = await query(sql, updateParams);
      if (result.length > 0) {
        res.json({ id: result[0].id });
      } else {
        res.status(404).json({ error: 'Trade not found during update' });
      }
    } else if (fiat_paid === undefined) {
      res.status(400).json({ error: 'No fields provided for update' });
    } else {
      res.json({ id: Number.parseInt(id, 10) });
    }
  }),
);

export default router;
