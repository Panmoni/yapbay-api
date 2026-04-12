import express, { type Response } from 'express';
import { query } from '../../db';
import { withErrorHandling } from '../../middleware/errorHandler';
import { handler } from '../../middleware/typedHandler';
import { validate } from '../../middleware/validate';
import { validateResponse } from '../../middleware/validateResponse';
import { adminEscrowParamsSchema, adminEscrowResponseSchema } from '../../schemas/admin';

const router = express.Router();

const schemas = { params: adminEscrowParamsSchema } as const;

// GET /admin/escrows/:trade_id
router.get(
  '/:trade_id',
  validate({ params: adminEscrowParamsSchema }),
  validateResponse(adminEscrowResponseSchema),
  withErrorHandling(
    handler(schemas, async (req, res: Response) => {
      const { trade_id } = req.params;
      const result = await query('SELECT * FROM escrows WHERE trade_id = $1', [trade_id]);
      if (result.length === 0) {
        res.status(404).json({ error: 'Escrow not found' });
        return;
      }
      res.json(result[0]);
    }),
  ),
);

export default router;
