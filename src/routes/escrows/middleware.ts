import { Response, NextFunction } from 'express';
import { query } from '../../db';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { AuthenticatedRequest } from '../../middleware/auth';

export const requireEscrowParticipant = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const { onchainEscrowId } = req.params;
  const networkId = req.networkId!;
  const jwtWalletAddress = getWalletAddressFromJWT(req);
  
  if (!jwtWalletAddress) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    // Verify the user is involved in this escrow on this network
    const escrowCheck = await query(
      `SELECT e.* FROM escrows e
       WHERE e.onchain_escrow_id = $1 AND e.network_id = $2
       AND (LOWER(e.seller_address) = LOWER($3) OR LOWER(e.buyer_address) = LOWER($3))`,
      [onchainEscrowId, networkId, jwtWalletAddress]
    );

    if (escrowCheck.length === 0) {
      res.status(404).json({ error: 'Escrow not found or access denied' });
      return;
    }

    req.escrowData = escrowCheck[0];
    next();
  } catch (error) {
    console.error('Error checking escrow access:', error);
    res.status(500).json({ error: 'Failed to verify escrow access' });
  }
};

export const requireEscrowList = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const jwtWalletAddress = getWalletAddressFromJWT(req);
  
  if (!jwtWalletAddress) {
    res.status(404).json({ error: 'Wallet address not found in token' });
    return;
  }

  next();
};