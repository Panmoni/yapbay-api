import express, { type Request, type Response } from 'express';
import { query } from '../../db';
import { withErrorHandling } from '../../middleware/errorHandler';

const router = express.Router();

// GET /admin/trades with pagination
router.get(
  '/',
  withErrorHandling(async (req: Request, res: Response) => {
    const page = Number.parseInt(req.query.page as string, 10) || 1;
    const limit = Number.parseInt(req.query.limit as string, 10) || 10;
    const offset = (page - 1) * limit;

    const result = await query('SELECT * FROM trades ORDER BY id LIMIT $1 OFFSET $2', [
      limit,
      offset,
    ]);
    // Optionally, get total count for pagination metadata
    const countResult = await query('SELECT COUNT(*) FROM trades', []);
    const total = Number.parseInt(countResult[0].count, 10);

    res.json({
      data: result,
      meta: { page, limit, total },
    });
  }),
);

export default router;
