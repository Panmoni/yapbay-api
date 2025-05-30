import { Response, NextFunction } from 'express';
import { query } from '../db';
import { getWalletAddressFromJWT } from '../utils/jwtUtils';
import { logError } from '../logger';
import { AuthenticatedRequest } from './auth';

// Middleware to check ownership
export const restrictToOwner = (resourceType: 'account' | 'offer', resourceKey: string) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const walletAddress = getWalletAddressFromJWT(req);
    if (!walletAddress) {
      console.error('[restrictToOwner] Failed to get wallet address from JWT for ownership check.');
      res.status(403).json({ error: 'No wallet address could be extracted from token' });
      return;
    }
    const resourceId = req.params.id || req.body[resourceKey];
    try {
      const table = resourceType === 'account' ? 'accounts' : 'offers';
      const column = resourceType === 'account' ? 'wallet_address' : 'creator_account_id';
      
      let result;
      if (resourceType === 'offer' && req.networkId) {
        // For offers, include network filtering
        result = await query(`SELECT ${column} FROM ${table} WHERE id = $1 AND network_id = $2`, [resourceId, req.networkId]);
      } else {
        // For accounts (cross-network) or when network not available
        result = await query(`SELECT ${column} FROM ${table} WHERE id = $1`, [resourceId]);
      }
      
      if (result.length === 0) {
        res.status(404).json({ error: `${resourceType} not found` });
        return;
      }
      const ownerField =
        resourceType === 'offer' ? result[0].creator_account_id : result[0].wallet_address;

      let ownerWalletAddress: string;
      if (resourceType === 'offer') {
        const accountCheck = await query('SELECT wallet_address FROM accounts WHERE id = $1', [
          ownerField,
        ]);
        if (accountCheck.length === 0) {
          res.status(404).json({ error: `Creator account for ${resourceType} not found` });
          return;
        }
        ownerWalletAddress = accountCheck[0].wallet_address;
      } else {
        ownerWalletAddress = ownerField;
      }

      if (ownerWalletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        res.status(403).json({
          error: `Unauthorized: You can only manage your own ${resourceType}s`,
        });
        return;
      }
      next();
    } catch (err) {
      logError(
        `[restrictToOwner] Error checking ownership for ${resourceType} ${resourceId}`,
        err as Error
      );
      res.status(500).json({ error: (err as Error).message });
    }
  };
};