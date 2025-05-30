import express, { Request, Response } from 'express';
import { query } from '../../db';
import { withErrorHandling } from '../../middleware/errorHandler';

const router = express.Router();

// GET /admin/escrows/:trade_id
router.get(
  '/:trade_id',
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

export default router;