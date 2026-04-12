/**
 * Business validation for trades.
 *
 * Shape checks (types, enums) are in `src/schemas/trades.ts`. This file
 * contains ONLY business rules that require async I/O or cross-field logic:
 *
 *   - Offer existence + availability (POST)
 *   - Buyer cannot trade with own offer (POST)
 *   - State transition validity (PUT — wired in M4)
 */

import type { NextFunction, Response } from 'express';
import { decimalMath, query } from '../../db';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { VALID_LEG_TRANSITIONS, VALID_OVERALL_TRANSITIONS } from '../../utils/stateTransitions';

/**
 * Business rules for trade creation.
 *
 * Runs AFTER Zod shape validation — `req.body` fields are typed.
 */
export const validateTradeCreationBusiness = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { leg1_offer_id, leg1_crypto_amount } = req.body;
  const networkId = req.networkId!;
  const jwtWalletAddress = getWalletAddressFromJWT(req);

  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }

  try {
    // Validate the offer exists and is available
    const leg1Offer = await query('SELECT * FROM offers WHERE id = $1 AND network_id = $2', [
      leg1_offer_id,
      networkId,
    ]);
    if (leg1Offer.length === 0) {
      res.status(404).json({ error: 'Leg 1 offer not found' });
      return;
    }

    const totalAvailable = String(leg1Offer[0].total_available_amount);
    const offerMinAmount = String(leg1Offer[0].min_amount);

    if (decimalMath.compare(totalAvailable, offerMinAmount) < 0) {
      res.status(400).json({ error: 'Offer no longer available' });
      return;
    }

    // Validate crypto amount if provided (already a string from Zod)
    if (leg1_crypto_amount !== undefined) {
      if (decimalMath.compare(leg1_crypto_amount, offerMinAmount) < 0) {
        res.status(400).json({ error: 'Trade amount below minimum offer amount' });
        return;
      }
      if (decimalMath.compare(leg1_crypto_amount, totalAvailable) > 0) {
        res.status(400).json({ error: 'Trade amount exceeds available amount' });
        return;
      }
    }

    // Verify user has an account
    const buyerAccount = await query('SELECT id FROM accounts WHERE wallet_address = $1', [
      jwtWalletAddress,
    ]);
    if (buyerAccount.length === 0) {
      res.status(403).json({ error: 'Buyer account not found' });
      return;
    }

    // Check user is not trading with their own offer
    const creatorAccount = await query('SELECT id, wallet_address FROM accounts WHERE id = $1', [
      leg1Offer[0].creator_account_id,
    ]);
    if (
      creatorAccount.length > 0 &&
      creatorAccount[0].wallet_address.toLowerCase() === jwtWalletAddress.toLowerCase()
    ) {
      res.status(400).json({ error: 'Cannot create a trade with your own offer' });
      return;
    }

    // Store validated data for the handler
    req.validatedOffer = leg1Offer[0];
    req.validatedBuyerAccount = buyerAccount[0];
    req.validatedCreatorAccount = creatorAccount[0];

    next();
  } catch {
    res.status(500).json({ error: 'Error validating trade creation' });
  }
};

/**
 * Business rules for trade state updates: validates state transitions.
 *
 * Shape validation (enum membership) is in Zod. This checks DB state.
 */
export const validateTradeUpdateBusiness = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { leg1_state, overall_status } = req.body;
  const { id } = req.params;

  if (leg1_state !== undefined || overall_status !== undefined) {
    try {
      const tradeResult = await query(
        'SELECT leg1_state, overall_status FROM trades WHERE id = $1',
        [id],
      );
      if (tradeResult.length === 0) {
        res.status(404).json({ error: 'Trade not found' });
        return;
      }

      const currentTrade = tradeResult[0];

      if (leg1_state !== undefined) {
        const currentLegState = currentTrade.leg1_state;
        const allowed = VALID_LEG_TRANSITIONS[currentLegState] || [];
        if (!allowed.includes(leg1_state)) {
          res.status(400).json({
            error: `Invalid state transition: ${currentLegState} -> ${leg1_state}`,
            allowedTransitions: allowed,
          });
          return;
        }
      }

      if (overall_status !== undefined) {
        const currentOverall = currentTrade.overall_status;
        const allowed = VALID_OVERALL_TRANSITIONS[currentOverall] || [];
        if (!allowed.includes(overall_status)) {
          res.status(400).json({
            error: `Invalid status transition: ${currentOverall} -> ${overall_status}`,
            allowedTransitions: allowed,
          });
          return;
        }
      }
    } catch {
      res.status(500).json({ error: 'Error validating trade state transition' });
      return;
    }
  }

  next();
};
