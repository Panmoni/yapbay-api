import express, { Request, Response } from 'express';
import { query } from '../../db';
import { withErrorHandling } from '../../middleware/errorHandler';

const router = express.Router();

// GET /admin/trades with pagination
router.get(
  '/',
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

export default router;