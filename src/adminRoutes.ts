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

// GET /admin/divvi-referrals - Get all Divvi referrals with pagination and filters
adminRouter.get(
  '/divvi-referrals',
  withErrorHandling(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    
    const status = req.query.status as string;
    const chainId = req.query.chainId as string;
    const walletAddress = req.query.walletAddress as string;

    let whereClause = '';
    const params: any[] = [limit, offset];
    let paramIndex = 3;

    const conditions: string[] = [];
    
    if (status) {
      conditions.push(`submission_status = $${paramIndex}`);
      params.push(parseInt(status));
      paramIndex++;
    }
    
    if (chainId) {
      conditions.push(`chain_id = $${paramIndex}`);
      params.push(parseInt(chainId));
      paramIndex++;
    }
    
    if (walletAddress) {
      conditions.push(`wallet_address ILIKE $${paramIndex}`);
      params.push(`%${walletAddress}%`);
      paramIndex++;
    }

    if (conditions.length > 0) {
      whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    const referrals = await query(
      `SELECT dr.*, t.id as trade_exists, a.username, a.email 
       FROM divvi_referrals dr 
       LEFT JOIN trades t ON dr.trade_id = t.id 
       LEFT JOIN accounts a ON LOWER(dr.wallet_address) = LOWER(a.wallet_address)
       ${whereClause}
       ORDER BY dr.created_at DESC 
       LIMIT $1 OFFSET $2`,
      params
    );

    // Get total count
    const countParams = params.slice(2); // Remove limit and offset
    const countResult = await query(
      `SELECT COUNT(*) FROM divvi_referrals dr ${whereClause}`,
      countParams
    );

    const totalCount = parseInt(countResult[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: referrals,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  })
);

// GET /admin/divvi-referrals/stats - Get Divvi referrals statistics
adminRouter.get(
  '/divvi-referrals/stats',
  withErrorHandling(async (req: Request, res: Response) => {
    try {
      // Overall stats
      const overallStats = await query(`
        SELECT 
          COUNT(*) as total_referrals,
          COUNT(CASE WHEN submission_status = 200 THEN 1 END) as successful_referrals,
          COUNT(CASE WHEN submission_status = 400 THEN 1 END) as bad_request_referrals,
          COUNT(CASE WHEN submission_status = 500 THEN 1 END) as server_error_referrals,
          COUNT(CASE WHEN submission_status IS NULL THEN 1 END) as unknown_status_referrals,
          COUNT(CASE WHEN submitted_providers_with_existing_referral IS NOT NULL 
                      AND jsonb_array_length(submitted_providers_with_existing_referral) > 0 
                 THEN 1 END) as referrals_with_existing
        FROM divvi_referrals
      `);

      // Stats by chain
      const chainStats = await query(`
        SELECT 
          chain_id,
          COUNT(*) as total_referrals,
          COUNT(CASE WHEN submission_status = 200 THEN 1 END) as successful_referrals
        FROM divvi_referrals 
        GROUP BY chain_id 
        ORDER BY total_referrals DESC
      `);

      // Recent activity (last 7 days)
      const recentActivity = await query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as referrals_count,
          COUNT(CASE WHEN submission_status = 200 THEN 1 END) as successful_count
        FROM divvi_referrals 
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY DATE(created_at) 
        ORDER BY date DESC
      `);

      res.json({
        success: true,
        data: {
          overall: overallStats[0],
          byChain: chainStats,
          recentActivity: recentActivity
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error fetching Divvi referral stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Divvi referral statistics'
      });
    }
  })
);

// GET /admin/divvi-referrals/:id - Get specific referral (admin view)
adminRouter.get(
  '/divvi-referrals/:id',
  withErrorHandling(async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const result = await query(
        `SELECT dr.*, t.id as trade_exists, a.username, a.email 
         FROM divvi_referrals dr 
         LEFT JOIN trades t ON dr.trade_id = t.id 
         LEFT JOIN accounts a ON LOWER(dr.wallet_address) = LOWER(a.wallet_address)
         WHERE dr.id = $1`,
        [id]
      );

      if (result.length === 0) {
        res.status(404).json({ error: 'Referral not found' });
        return;
      }

      res.json({
        success: true,
        data: result[0]
      });

    } catch (error) {
      console.error('Error fetching Divvi referral:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        details: (error as Error).message 
      });
    }
  })
);

export default adminRouter;
</edits>
