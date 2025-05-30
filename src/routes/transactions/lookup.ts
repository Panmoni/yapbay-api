import express, { Request, Response } from 'express';
import { query } from '../../db';
import { withErrorHandling } from '../../middleware/errorHandler';
import { logError } from '../../logger';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { AuthenticatedRequest } from '../../middleware/auth';

const router = express.Router();

// GET /transactions/trade/:id - Get all transactions for a specific trade
router.get(
  '/trade/:id',
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { type } = req.query;

    try {
      // Verify trade exists
      const tradeResult = await query('SELECT id FROM trades WHERE id = $1', [id]);
      if (tradeResult.length === 0) {
        res.status(404).json({
          error: 'Trade not found',
          details: `No trade found with ID ${id}`
        });
        return;
      }

      // Build the query to get all transactions for this trade
      let sql = `
        SELECT 
          t.id, 
          t.transaction_hash, 
          t.status, 
          t.type as transaction_type, 
          t.block_number, 
          t.sender_address as from_address, 
          t.receiver_or_contract_address as to_address, 
          t.gas_used, 
          t.error_message, 
          t.related_trade_id as trade_id, 
          t.related_escrow_db_id as escrow_id, 
          t.created_at,
          tr.leg1_crypto_amount as amount,
          tr.leg1_crypto_token as token_type
        FROM 
          transactions t
        LEFT JOIN
          trades tr ON t.related_trade_id = tr.id
        WHERE 
          t.related_trade_id = $1
      `;
      
      const params: (string | number)[] = [id];
      let paramIndex = 2;

      // Add type filter if provided
      if (type) {
        sql += ` AND t.type = $${paramIndex}`;
        params.push(type as string);
        paramIndex++;
      }

      // Order by creation date, newest first
      sql += ' ORDER BY t.created_at DESC';

      const result = await query(sql, params);
      
      // Process results to parse any metadata stored in error_message
      const transactions = result.map(tx => {
        let metadata = null;
        if (tx.error_message && tx.status !== 'FAILED') {
          try {
            metadata = JSON.parse(tx.error_message);
            tx.error_message = null; // Clear error_message if it was used for metadata
          } catch (error) {
            // Not valid JSON, leave as is (probably an actual error message)
            console.debug(`Could not parse metadata from error_message: ${(error as Error).message}`);
          }
        }
        
        return {
          ...tx,
          metadata,
          transaction_type: tx.transaction_type // Ensure transaction_type is explicitly included
        };
      });

      res.json(transactions);
    } catch (err) {
      logError(`Error in /transactions/trade/${id} endpoint`, err as Error);
      res.status(500).json({
        error: (err as Error).message,
        details: 'Error occurred while fetching trade transactions'
      });
    }
  })
);

// GET /transactions/user - Get all transactions for authenticated user
router.get(
  '/user',
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const walletAddress = getWalletAddressFromJWT(req);
    const { type, limit = 50, offset = 0 } = req.query;

    if (!walletAddress) {
      res.status(401).json({
        error: 'Authentication required',
        details: 'Valid JWT with wallet address is required'
      });
      return;
    }

    try {
      // Build the query to get transactions where the user is either sender or receiver
      let sql = `
        SELECT 
          t.id, 
          t.transaction_hash, 
          t.status, 
          t.type as transaction_type, 
          t.block_number, 
          t.sender_address as from_address, 
          t.receiver_or_contract_address as to_address, 
          t.gas_used, 
          t.error_message, 
          t.related_trade_id as trade_id, 
          t.related_escrow_db_id as escrow_id, 
          t.created_at,
          tr.leg1_crypto_amount as amount,
          tr.leg1_crypto_token as token_type
        FROM 
          transactions t
        LEFT JOIN
          trades tr ON t.related_trade_id = tr.id
        WHERE 
          (t.sender_address = $1 OR t.receiver_or_contract_address = $1)
      `;
      
      const params: (string | number)[] = [walletAddress];
      let paramIndex = 2;

      // Add type filter if provided
      if (type) {
        sql += ` AND t.type = $${paramIndex}`;
        params.push(type as string);
        paramIndex++;
      }

      // Order by creation date, newest first
      sql += ' ORDER BY t.created_at DESC';
      
      // Add pagination
      sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(Number(limit));
      params.push(Number(offset));

      const result = await query(sql, params);
      
      // Process results to parse any metadata stored in error_message
      const transactions = result.map(tx => {
        let metadata = null;
        if (tx.error_message && tx.status !== 'FAILED') {
          try {
            metadata = JSON.parse(tx.error_message);
            tx.error_message = null; // Clear error_message if it was used for metadata
          } catch (error) {
            // Not valid JSON, leave as is (probably an actual error message)
            console.debug(`Could not parse metadata from error_message: ${(error as Error).message}`);
          }
        }
        
        return {
          ...tx,
          metadata
        };
      });

      res.json(transactions);
    } catch (err) {
      logError(`Error in /transactions/user endpoint for wallet ${walletAddress}`, err as Error);
      res.status(500).json({
        error: (err as Error).message,
        details: 'Error occurred while fetching user transactions'
      });
    }
  })
);

export default router;