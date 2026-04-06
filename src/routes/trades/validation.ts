import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { query } from '../../db';
import { VALID_LEG_TRANSITIONS, VALID_OVERALL_TRANSITIONS } from '../../utils/stateTransitions';

export const validateTradeCreation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const {
    leg1_offer_id,
    leg1_crypto_amount,
    leg1_fiat_amount,
    from_fiat_currency,
    destination_fiat_currency,
  } = req.body;
  const networkId = req.networkId!;
  const jwtWalletAddress = getWalletAddressFromJWT(req);

  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }

  if (!leg1_offer_id) {
    res.status(400).json({ error: 'leg1_offer_id is required' });
    return;
  }

  try {
    // Validate the offer exists and is available
    const leg1Offer = await query('SELECT * FROM offers WHERE id = $1 AND network_id = $2', [leg1_offer_id, networkId]);
    if (leg1Offer.length === 0) {
      res.status(404).json({ error: 'Leg 1 offer not found' });
      return;
    }

    // Convert string values to numbers for proper comparison
    const totalAvailable = parseFloat(leg1Offer[0].total_available_amount);
    const offerMinAmount = parseFloat(leg1Offer[0].min_amount);

    if (totalAvailable < offerMinAmount) {
      res.status(400).json({ error: 'Offer no longer available' });
      return;
    }

    // Validate crypto amount if provided
    if (leg1_crypto_amount !== undefined) {
      if (typeof leg1_crypto_amount !== 'number' || leg1_crypto_amount <= 0) {
        res.status(400).json({ error: 'leg1_crypto_amount must be a positive number' });
        return;
      }

      if (leg1_crypto_amount < offerMinAmount) {
        res.status(400).json({ error: 'Trade amount below minimum offer amount' });
        return;
      }

      if (leg1_crypto_amount > totalAvailable) {
        res.status(400).json({ error: 'Trade amount exceeds available amount' });
        return;
      }
    }

    // Validate fiat amount if provided
    if (leg1_fiat_amount !== undefined && (typeof leg1_fiat_amount !== 'number' || leg1_fiat_amount <= 0)) {
      res.status(400).json({ error: 'leg1_fiat_amount must be a positive number' });
      return;
    }

    // Validate currencies
    if (from_fiat_currency && !/^[A-Z]{3}$/.test(from_fiat_currency)) {
      res.status(400).json({ error: 'from_fiat_currency must be a 3-letter uppercase code' });
      return;
    }

    if (destination_fiat_currency && !/^[A-Z]{3}$/.test(destination_fiat_currency)) {
      res.status(400).json({ error: 'destination_fiat_currency must be a 3-letter uppercase code' });
      return;
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

    if (creatorAccount.length > 0 && 
        creatorAccount[0].wallet_address.toLowerCase() === jwtWalletAddress.toLowerCase()) {
      res.status(400).json({ error: 'Cannot create a trade with your own offer' });
      return;
    }

    // Store validated offer data for use in the route handler
    req.validatedOffer = leg1Offer[0];
    req.validatedBuyerAccount = buyerAccount[0];
    req.validatedCreatorAccount = creatorAccount[0];

    next();
  } catch {
    res.status(500).json({ error: 'Error validating trade creation' });
    return;
  }
};

export const validateTradeUpdate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const { leg1_state, overall_status, fiat_paid } = req.body;
  const { id } = req.params;

  // Validate leg1_state if provided
  if (leg1_state !== undefined) {
    const validStates = Object.keys(VALID_LEG_TRANSITIONS);
    if (!validStates.includes(leg1_state)) {
      res.status(400).json({
        error: 'Invalid leg1_state',
        validStates
      });
      return;
    }
  }

  // Validate overall_status if provided
  if (overall_status !== undefined) {
    const validStatuses = Object.keys(VALID_OVERALL_TRANSITIONS);
    if (!validStatuses.includes(overall_status)) {
      res.status(400).json({
        error: 'Invalid overall_status',
        validStatuses
      });
      return;
    }
  }

  // Validate fiat_paid if provided
  if (fiat_paid !== undefined && typeof fiat_paid !== 'boolean') {
    res.status(400).json({ error: 'fiat_paid must be a boolean' });
    return;
  }

  // Enforce state machine transitions by checking current state
  if (leg1_state !== undefined || overall_status !== undefined) {
    try {
      const tradeResult = await query('SELECT leg1_state, overall_status FROM trades WHERE id = $1', [id]);
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