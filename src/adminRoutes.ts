import { Router, Request, Response } from 'express';
import { query } from './db';
import { withErrorHandling } from './middleware/errorHandler';

const adminRouter = Router();

// GET /admin/trades with pagination
adminRouter.get(
  '/trades',
  withErrorHandling(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const result = await query('SELECT * FROM trades ORDER BY id LIMIT $1 OFFSET $2', [
      limit,
      offset,
    ]);
    // Optionally, get total count for pagination metadata
    const countResult = await query('SELECT COUNT(*) FROM trades', []);
    const total = parseInt(countResult[0].count, 10);

    res.json({
      data: result,
      meta: { page, limit, total },
    });
  })
);

// GET /admin/escrows/:trade_id
adminRouter.get(
  '/escrows/:trade_id',
  withErrorHandling(async (req: Request, res: Response) => {
    const { trade_id } = req.params;
    const result = await query('SELECT * FROM escrows WHERE trade_id = $1', [trade_id]);
    if (result.length === 0) {
      res.status(404).json({ error: 'Escrow not found' });
      return;
    }
    res.json(result[0]);
  })
);

export default adminRouter;
