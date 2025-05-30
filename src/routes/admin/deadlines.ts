import express, { Request, Response } from 'express';
import { withErrorHandling } from '../../middleware/errorHandler';
import { getAllNetworksDeadlineStats, getDeadlineStats } from '../../services/deadlineService';
import { NetworkService } from '../../services/networkService';

const router = express.Router();

// GET /admin/deadline-stats - Get deadline statistics for all networks
router.get(
  '/',
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
router.get(
  '/:networkId',
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

export default router;