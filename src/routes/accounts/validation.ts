import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';

export const validateAccountCreation = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const { wallet_address, username } = req.body;

  const jwtWalletAddress = getWalletAddressFromJWT(req);
  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }

  if (!wallet_address) {
    res.status(400).json({ error: 'wallet_address is required' });
    return;
  }

  if (wallet_address.toLowerCase() !== jwtWalletAddress.toLowerCase()) {
    res.status(403).json({ error: 'Wallet address must match authenticated user' });
    return;
  }

  if (username && username.length > 25) {
    res.status(400).json({ error: 'Username must not exceed 25 characters' });
    return;
  }

  next();
};

export const validateAccountUpdate = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const { username } = req.body;

  if (username && username.length > 25) {
    res.status(400).json({ error: 'Username must not exceed 25 characters' });
    return;
  }

  next();
};