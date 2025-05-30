import express, { Request, Response } from 'express';
import { query } from '../../db';
import { requireNetwork } from '../../middleware/networkMiddleware';
import { withErrorHandling } from '../../middleware/errorHandler';
import { logError } from '../../logger';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { sendNetworkResponse } from '../../utils/routeHelpers';

const router = express.Router();

// Get offer details (publicly accessible)
router.get(
  '/:id',
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const networkId = req.networkId!;
    try {
      const result = await query('SELECT * FROM offers WHERE id = $1 AND network_id = $2', [id, networkId]);
      if (result.length === 0) {
        res.status(404).json({ error: 'Offer not found' });
        return;
      }
      sendNetworkResponse(res, result[0], req.network!.name, 'offer');
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  })
);

// List offers (publicly accessible but can filter by owner if authenticated)
router.get(
  '/',
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { type, token, owner } = req.query;
    const networkId = req.networkId!;
    try {
      let sql = 'SELECT * FROM offers WHERE network_id = $1';
      const params: (string | number)[] = [networkId];

      if (type) {
        sql += ' AND offer_type = $' + (params.length + 1);
        params.push(type as string);
      }
      if (token) {
        sql += ' AND token = $' + (params.length + 1);
        params.push(token as string);
      }

      // If authenticated and requesting own offers
      const walletAddress = getWalletAddressFromJWT(req);
      if (owner === 'me' && walletAddress) {
        sql +=
          ' AND creator_account_id IN (SELECT id FROM accounts WHERE LOWER(wallet_address) = LOWER($' +
          (params.length + 1) +
          '))';
        params.push(walletAddress);
      } else if (owner === 'me' && !walletAddress) {
        console.warn(
          '[GET /offers] owner=me filter requested but no wallet address found in token.'
        );
      }

      const result = await query(sql, params);
      sendNetworkResponse(res, result, req.network!.name, 'offers');
    } catch (err) {
      logError('[GET /offers] Error fetching offers', err as Error);
      res.status(500).json({ error: (err as Error).message });
    }
  })
);

export default router;