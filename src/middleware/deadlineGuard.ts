import { Request, Response, NextFunction } from 'express';
import { query } from '../db';

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
      `SELECT ${deadlineField} FROM trades WHERE id = $1`,
      [id]
    );
    if (result.length === 0) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }
    const dl = result[0][deadlineField] as Date | string;
    if (dl && new Date() > new Date(dl)) {
      res.status(400).json({ error: errorMsg });
      return;
    }
    next();
  };
}
