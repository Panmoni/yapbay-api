import express, { type Response } from 'express';
import { withErrorHandling } from '../../middleware/errorHandler';
import { handler } from '../../middleware/typedHandler';
import { validate } from '../../middleware/validate';
import { validateResponse } from '../../middleware/validateResponse';
import {
  deadlineStatsAllResponseSchema,
  deadlineStatsNetworkIdParamsSchema,
  deadlineStatsNetworkResponseSchema,
  deadlineStatsQuerySchema,
} from '../../schemas/admin';
import { getAllNetworksDeadlineStats, getDeadlineStats } from '../../services/deadlineService';
import { NetworkService } from '../../services/networkService';

const router = express.Router();

const allStatsSchemas = { query: deadlineStatsQuerySchema } as const;

// GET /admin/deadline-stats - Get deadline statistics for all networks
router.get(
  '/',
  validate({ query: deadlineStatsQuerySchema }),
  validateResponse(deadlineStatsAllResponseSchema),
  withErrorHandling(
    handler(allStatsSchemas, async (_req, res: Response) => {
      try {
        const allStats = await getAllNetworksDeadlineStats();

        res.json({
          success: true,
          data: allStats,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Error fetching deadline stats:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch deadline statistics',
        });
      }
    }),
  ),
);

const networkStatsSchemas = { params: deadlineStatsNetworkIdParamsSchema } as const;

// GET /admin/deadline-stats/:networkId - Get deadline statistics for specific network
router.get(
  '/:networkId',
  validate({ params: deadlineStatsNetworkIdParamsSchema }),
  validateResponse(deadlineStatsNetworkResponseSchema),
  withErrorHandling(
    handler(networkStatsSchemas, async (req, res: Response) => {
      try {
        const { networkId } = req.params;

        const network = await NetworkService.getNetworkById(networkId);
        if (!network) {
          res.status(404).json({
            success: false,
            error: 'Network not found',
          });
          return;
        }

        const stats = await getDeadlineStats(networkId);

        res.json({
          success: true,
          data: {
            networkId,
            networkName: network.name,
            ...stats,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Error fetching network deadline stats:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch network deadline statistics',
        });
      }
    }),
  ),
);

export default router;
