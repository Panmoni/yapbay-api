/**
 * Business validation for accounts.
 *
 * Shape validation (field presence, types, lengths) is handled by Zod schemas
 * in `src/schemas/accounts.ts`. This file contains ONLY business rules that
 * require async I/O or cross-field logic:
 *
 *   - JWT wallet address must match the body's wallet_address on creation.
 */

import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';

/**
 * Business rule: the wallet_address in the body must match the JWT's wallet.
 *
 * Runs AFTER Zod shape validation, so `req.body.wallet_address` is guaranteed
 * to be a valid address string.
 */
export const validateAccountCreationBusiness = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const { wallet_address } = req.body;

  const jwtWalletAddress = getWalletAddressFromJWT(req);
  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }

  if (wallet_address.toLowerCase() !== jwtWalletAddress.toLowerCase()) {
    res.status(403).json({ error: 'Wallet address must match authenticated user' });
    return;
  }

  next();
};
