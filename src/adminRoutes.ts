import { Router, Request, Response } from 'express';
import { query } from './db';
import { withErrorHandling } from './middleware/errorHandler';
import { getAllNetworksDeadlineStats, getDeadlineStats } from './services/deadlineService';
import { NetworkService } from './services/networkService';

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

// GET /admin/deadline-stats - Get deadline statistics for all networks
adminRouter.get(
  '/deadline-stats',
  withErrorHandling(async (req: Request, res: Response) => {
    try {
      const allStats = await getAllNetworksDeadlineStats();
      
      res.json({
        success: true,
        data: allStats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error fetching deadline stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch deadline statistics'
      });
    }
  })
);

// GET /admin/deadline-stats/:networkId - Get deadline statistics for specific network
adminRouter.get(
  '/deadline-stats/:networkId',
  withErrorHandling(async (req: Request, res: Response) => {
    try {
      const networkId = parseInt(req.params.networkId);
      
      if (isNaN(networkId)) {
        res.status(400).json({
          success: false,
          error: 'Invalid network ID'
        });
        return;
      }

      const network = await NetworkService.getNetworkById(networkId);
      if (!network) {
        res.status(404).json({
          success: false,
          error: 'Network not found'
        });
        return;
      }

      const stats = await getDeadlineStats(networkId);
      
      res.json({
        success: true,
        data: {
          networkId,
          networkName: network.name,
          ...stats
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error fetching network deadline stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch network deadline statistics'
      });
    }
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
