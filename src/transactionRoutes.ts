import express, { Response, Router } from 'express';
import { query, recordTransaction, TransactionType, TransactionStatus } from './db';
import { logError } from './logger';
import { getWalletAddressFromJWT } from './utils/jwtUtils';
import { withErrorHandling } from './middleware/errorHandler';
import { Request } from 'express';
import { CustomJwtPayload } from './utils/jwtUtils';

// Extend Express Request interface to match the one in routes.ts
interface ExtendedRequest extends Request {
  user?: CustomJwtPayload;
}

const router: Router = express.Router();

// Record a new transaction
router.post(
  '/record',
  withErrorHandling(async (req: ExtendedRequest, res: Response): Promise<void> => {
    const {
      trade_id,
      escrow_id,
      transaction_hash,
      transaction_type,
      from_address,
      to_address,
      amount,
      token_type,
      block_number,
      metadata,
      status = 'PENDING' // Default to PENDING if not provided
    } = req.body;

    // Validate required fields
    if (!transaction_hash || !transaction_type || !from_address || !trade_id) {
      res.status(400).json({
        error: 'Missing required fields',
        details: 'transaction_hash, transaction_type, from_address, and trade_id are required'
      });
      return;
    }

    try {
      // Verify the transaction type is valid
      const validTransactionTypes: string[] = ['CREATE_ESCROW', 'FUND_ESCROW', 'MARK_FIAT_PAID', 'RELEASE_ESCROW', 'CANCEL_ESCROW', 'DISPUTE_ESCROW', 'OPEN_DISPUTE', 'RESPOND_DISPUTE', 'RESOLVE_DISPUTE', 'OTHER'];
      if (!validTransactionTypes.includes(transaction_type)) {
        res.status(400).json({
          error: 'Invalid transaction type',
          details: `Transaction type must be one of: ${validTransactionTypes.join(', ')}`
        });
        return;
      }

      // Verify the status is valid if provided
      const validStatuses: string[] = ['PENDING', 'SUCCESS', 'FAILED'];
      if (status && !validStatuses.includes(status)) {
        res.status(400).json({
          error: 'Invalid transaction status',
          details: `Status must be one of: ${validStatuses.join(', ')}`
        });
        return;
      }

      // Verify trade exists
      const tradeResult = await query('SELECT id FROM trades WHERE id = $1', [trade_id]);
      if (tradeResult.length === 0) {
        res.status(404).json({
          error: 'Trade not found',
          details: `No trade found with ID ${trade_id}`
        });
        return;
      }

      // Verify escrow exists if provided
      let escrowDbId = null;
      if (escrow_id) {
        const escrowResult = await query('SELECT id FROM escrows WHERE id = $1', [escrow_id]);
        if (escrowResult.length === 0) {
          res.status(404).json({
            error: 'Escrow not found',
            details: `No escrow found with ID ${escrow_id}`
          });
          return;
        }
        escrowDbId = escrow_id;
      }

      // Record the transaction
      const transactionId = await recordTransaction({
        transaction_hash,
        status: status as TransactionStatus,
        type: transaction_type as TransactionType,
        block_number: block_number || null,
        sender_address: from_address,
        receiver_or_contract_address: to_address || null,
        related_trade_id: trade_id,
        related_escrow_db_id: escrowDbId,
        // Store additional metadata in error_message field for now
        error_message: metadata ? JSON.stringify(metadata) : null
      });

      if (transactionId === null) {
        res.status(500).json({
          error: 'Failed to record transaction',
          details: 'Database operation failed'
        });
        return;
      }

      res.status(201).json({
        success: true,
        transactionId,
        txHash: transaction_hash,
        blockNumber: block_number || null
      });
    } catch (err) {
      logError(`Error in /transactions/record endpoint for trade ${trade_id}`, err as Error);
      res.status(500).json({
        error: (err as Error).message,
        details: 'Error occurred while recording transaction'
      });
    }
  })
);

// Get transactions for a specific trade
router.get(
  '/trade/:id',
  withErrorHandling(async (req: ExtendedRequest, res: Response): Promise<void> => {
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

      // Build the query
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
          t.created_at
        FROM 
          transactions t
        WHERE 
          t.related_trade_id = $1
      `;
      
      const params: any[] = [id];

      // Add type filter if provided
      if (type) {
        sql += ' AND t.type = $2';
        params.push(type);
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
          } catch (e) {
            // Not valid JSON, leave as is (probably an actual error message)
          }
        }
        
        return {
          ...tx,
          metadata
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

// Get transactions for the authenticated user
router.get(
  '/user',
  withErrorHandling(async (req: ExtendedRequest, res: Response): Promise<void> => {
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
      
      const params: any[] = [walletAddress];
      let paramIndex = 2;

      // Add type filter if provided
      if (type) {
        sql += ` AND t.type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }

      // Order by creation date, newest first
      sql += ' ORDER BY t.created_at DESC';
      
      // Add pagination
      sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit);
      params.push(offset);

      const result = await query(sql, params);
      
      // Process results to parse any metadata stored in error_message
      const transactions = result.map(tx => {
        let metadata = null;
        if (tx.error_message && tx.status !== 'FAILED') {
          try {
            metadata = JSON.parse(tx.error_message);
            tx.error_message = null; // Clear error_message if it was used for metadata
          } catch (e) {
            // Not valid JSON, leave as is (probably an actual error message)
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
