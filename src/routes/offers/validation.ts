import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { query } from '../../db';

export const validateOfferCreation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const { creator_account_id, offer_type, min_amount, fiat_currency = 'USD' } = req.body;
  const jwtWalletAddress = getWalletAddressFromJWT(req);
  
  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }
  
  if (!['BUY', 'SELL'].includes(offer_type)) {
    res.status(400).json({ error: 'Offer type must be BUY or SELL' });
    return;
  }
  
  if (!/^[A-Z]{3}$/.test(fiat_currency)) {
    res.status(400).json({ error: 'Fiat currency must be a 3-letter uppercase code' });
    return;
  }
  
  if (typeof min_amount !== 'number' || min_amount < 0) {
    res.status(400).json({ error: 'Min amount must be a non-negative number' });
    return;
  }
  
  if (min_amount > 1000000) {
    res.status(400).json({ error: 'Min amount must not exceed 1,000,000' });
    return;
  }

  // Verify account ownership
  try {
    const accountCheck = await query('SELECT wallet_address FROM accounts WHERE id = $1', [
      creator_account_id,
    ]);
    if (
      accountCheck.length === 0 ||
      accountCheck[0].wallet_address.toLowerCase() !== jwtWalletAddress.toLowerCase()
    ) {
      res
        .status(403)
        .json({ error: 'Unauthorized: You can only create offers for your own account' });
      return;
    }
  } catch {
    res.status(500).json({ error: 'Error validating account ownership' });
    return;
  }

  next();
};

export const validateOfferUpdate = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const {
    min_amount,
    max_amount,
    total_available_amount,
    rate_adjustment,
    fiat_currency,
    offer_type,
  } = req.body;

  if (min_amount !== undefined && (typeof min_amount !== 'number' || min_amount < 0)) {
    res.status(400).json({ error: 'Min amount must be a non-negative number' });
    return;
  }

  if (max_amount !== undefined && (typeof max_amount !== 'number' || max_amount < 0)) {
    res.status(400).json({ error: 'Max amount must be a non-negative number' });
    return;
  }

  if (total_available_amount !== undefined && (typeof total_available_amount !== 'number' || total_available_amount < 0)) {
    res.status(400).json({ error: 'Total available amount must be a non-negative number' });
    return;
  }

  if (rate_adjustment !== undefined && (typeof rate_adjustment !== 'number' || rate_adjustment <= 0)) {
    res.status(400).json({ error: 'Rate adjustment must be a positive number' });
    return;
  }

  if (fiat_currency !== undefined && !/^[A-Z]{3}$/.test(fiat_currency)) {
    res.status(400).json({ error: 'Fiat currency must be a 3-letter uppercase code' });
    return;
  }

  if (offer_type !== undefined && !['BUY', 'SELL'].includes(offer_type)) {
    res.status(400).json({ error: 'Offer type must be BUY or SELL' });
    return;
  }

  next();
};