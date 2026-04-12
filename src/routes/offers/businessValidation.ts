/**
 * Business validation for offers.
 *
 * Shape checks (types, enums, string lengths) are in `src/schemas/offers.ts`.
 * This file contains ONLY business rules that require async I/O:
 *
 *   - creator_account_id must belong to the JWT wallet address.
 */

import type { NextFunction, Response } from 'express';
import { query } from '../../db';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';

/**
 * On offer creation, the creator_account_id must resolve to the JWT wallet.
 *
 * Runs AFTER Zod shape validation — `req.body.creator_account_id` is a
 * positive integer.
 */
export const validateOfferCreationBusiness = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { creator_account_id } = req.body;
  const jwtWalletAddress = getWalletAddressFromJWT(req);

  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }

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
