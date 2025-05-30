import { Response, NextFunction } from 'express';
import { query } from '../../db';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { logError } from '../../logger';
import { AuthenticatedRequest } from '../../middleware/auth';

export const requireTradeParticipant = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const networkId = req.networkId!;
  const requesterWalletAddress = getWalletAddressFromJWT(req);

  if (!requesterWalletAddress) {
    res.status(401).json({ error: 'Authentication required to access trade' });
    return;
  }

  try {
    // Fetch trade data including all potential participant account IDs
    const tradeResult = await query(
      'SELECT *, leg1_seller_account_id, leg1_buyer_account_id, leg2_seller_account_id, leg2_buyer_account_id FROM trades WHERE id = $1 AND network_id = $2',
      [id, networkId]
    );
    
    if (tradeResult.length === 0) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }
    
    const tradeData = tradeResult[0];

    // Collect unique, non-null participant account IDs
    const participantAccountIds = [
      tradeData.leg1_seller_account_id,
      tradeData.leg1_buyer_account_id,
      tradeData.leg2_seller_account_id,
      tradeData.leg2_buyer_account_id,
    ].filter((accountId): accountId is number => accountId !== null && accountId !== undefined);

    const uniqueParticipantAccountIds = [...new Set(participantAccountIds)];

    if (uniqueParticipantAccountIds.length === 0) {
      logError(
        `Trade ${id} has no valid participant account IDs.`,
        new Error('Missing participant account IDs in trade data')
      );
      res.status(500).json({ error: 'Internal server error processing trade participants' });
      return;
    }

    // Fetch wallet addresses for all participants in one query
    const accountsResult = await query(
      'SELECT id, wallet_address FROM accounts WHERE id = ANY($1::int[])',
      [uniqueParticipantAccountIds]
    );

    // Create a set of participant wallet addresses (lowercase)
    const participantWallets = new Set(
      accountsResult.map(acc => acc.wallet_address.toLowerCase())
    );

    // Check if the requester is a participant
    if (!participantWallets.has(requesterWalletAddress.toLowerCase())) {
      res.status(403).json({ error: 'Forbidden: You are not authorized to access this trade' });
      return;
    }

    // Store trade data for use in route handlers
    req.tradeData = tradeData;
    next();
  } catch (err) {
    logError(`Error checking trade participation for trade ${id}`, err as Error);
    res.status(500).json({ error: (err as Error).message });
  }
};

export const requireTradeParticipantForUpdate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const networkId = req.networkId!;
  const jwtWalletAddress = getWalletAddressFromJWT(req);

  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }

  try {
    const trade = await query('SELECT * FROM trades WHERE id = $1 AND network_id = $2', [id, networkId]);
    if (trade.length === 0) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }

    const sellerWallet = await query('SELECT wallet_address FROM accounts WHERE id = $1', [
      trade[0].leg1_seller_account_id,
    ]);
    const buyerWallet = await query('SELECT wallet_address FROM accounts WHERE id = $1', [
      trade[0].leg1_buyer_account_id,
    ]);

    const isParticipant =
      (sellerWallet.length > 0 &&
        sellerWallet[0].wallet_address.toLowerCase() === jwtWalletAddress.toLowerCase()) ||
      (buyerWallet.length > 0 &&
        buyerWallet[0].wallet_address.toLowerCase() === jwtWalletAddress.toLowerCase());

    if (!isParticipant) {
      res.status(403).json({ error: 'Unauthorized: Only trade participants can update' });
      return;
    }

    req.tradeData = trade[0];
    next();
  } catch (err) {
    logError(`Error checking trade update permissions for trade ${id}`, err as Error);
    res.status(500).json({ error: (err as Error).message });
  }
};