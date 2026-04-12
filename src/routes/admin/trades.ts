import express, { type Response } from 'express';
import { query } from '../../db';
import { withErrorHandling } from '../../middleware/errorHandler';
import { handler } from '../../middleware/typedHandler';
import { validate } from '../../middleware/validate';
import { validateResponse } from '../../middleware/validateResponse';
import { adminTradesQuerySchema, adminTradesResponseSchema } from '../../schemas/admin';

const router = express.Router();

const schemas = { query: adminTradesQuerySchema } as const;

// GET /admin/trades with pagination
router.get(
  '/',
  validate({ query: adminTradesQuerySchema }),
  validateResponse(adminTradesResponseSchema),
  withErrorHandling(
    handler(schemas, async (req, res: Response) => {
      const { page, limit } = req.query;
      const offset = (page - 1) * limit;

      const result = await query('SELECT * FROM trades ORDER BY id LIMIT $1 OFFSET $2', [
        limit,
        offset,
      ]);
      const countResult = await query('SELECT COUNT(*) FROM trades', []);
      const total = Number.parseInt(countResult[0].count, 10);

      res.json({
        data: result,
        meta: { page, limit, total },
      });
    }),
  ),
);

export default router;
