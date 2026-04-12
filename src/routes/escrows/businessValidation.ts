/**
 * Business validation for escrows.
 *
 * Shape + network-specific field checks are in Zod schemas
 * (`src/schemas/escrows.ts`). This file contains ONLY business rules:
 *
 *   - Seller must match JWT wallet address.
 */

import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';

/**
 * Business rule: the `seller` in the escrow record body must match the JWT.
 */
export const validateEscrowRecordBusiness = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const { seller } = req.body;
  const jwtWalletAddress = getWalletAddressFromJWT(req);

  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }

  if (!seller || jwtWalletAddress.toLowerCase() !== seller.toLowerCase()) {
    res.status(403).json({ error: 'Seller must match authenticated user and be provided' });
    return;
  }

  next();
};

/**
 * Auth check: user must be authenticated to access escrow list.
 */
export const validateEscrowAccess = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const jwtWalletAddress = getWalletAddressFromJWT(req);

  if (!jwtWalletAddress) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  next();
};
