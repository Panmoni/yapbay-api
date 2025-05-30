import express, { Request, Response } from 'express';
import { query } from '../../db';
import { withErrorHandling } from '../../middleware/errorHandler';
import { calculatePagination, sendPaginatedResponse, sendSuccess, sendError } from '../../utils/routeHelpers';

const router = express.Router();

// GET /admin/divvi-referrals - Get all Divvi referrals with pagination and filters
router.get(
  '/',
  withErrorHandling(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    
    const status = req.query.status as string;
    const chainId = req.query.chainId as string;
    const walletAddress = req.query.walletAddress as string;

    let whereClause = '';
    const params: unknown[] = [limit, offset];
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
    const pagination = calculatePagination(page, limit, totalCount);

    sendPaginatedResponse(res, referrals, pagination);
  })
);

// GET /admin/divvi-referrals/stats - Get Divvi referrals statistics
router.get(
  '/stats',
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
router.get(
  '/:id',
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
        sendError(res, 'Referral not found', 404);
        return;
      }

      sendSuccess(res, result[0]);

    } catch (error) {
      console.error('Error fetching Divvi referral:', error);
      sendError(res, 'Internal server error', 500, (error as Error).message);
    }
  })
);

export default router;