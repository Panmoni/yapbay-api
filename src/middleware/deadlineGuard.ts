import { Request, Response, NextFunction } from 'express';
import { query } from '../db';

// States where a trade should not be cancelled, regardless of deadline
const UNCANCELABLE_STATES = ['FIAT_PAID', 'RELEASED', 'DISPUTED', 'RESOLVED'];

/**
 * Middleware to enforce a timestamp deadline on trades.
 * @param deadlineField Column name for deadline in trades table
 * @param errorMsg Error message returned when deadline has passed
 */
export function deadlineGuard(
  deadlineField: string,
  errorMsg: string
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const { id } = req.params;
    const result = await query(
      `SELECT ${deadlineField}, leg1_state, leg2_state FROM trades WHERE id = $1`,
      [id]
    );
    if (result.length === 0) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }
    
    // Check if trade is in an uncancelable state
    const trade = result[0];
    if (UNCANCELABLE_STATES.includes(trade.leg1_state) || UNCANCELABLE_STATES.includes(trade.leg2_state)) {
      res.status(400).json({ 
        error: 'Trade cannot be cancelled', 
        detail: `Trade is in state leg1=${trade.leg1_state}, leg2=${trade.leg2_state} which prevents cancellation` 
      });
      return;
    }
    
    const dl = trade[deadlineField] as Date | string;
    if (dl && new Date() > new Date(dl)) {
      res.status(400).json({ error: errorMsg });
      return;
    }
    next();
  };
}
