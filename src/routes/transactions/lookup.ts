import express, { type Request, type Response } from 'express';
import { query } from '../../db';
import { logError } from '../../logger';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { withErrorHandling } from '../../middleware/errorHandler';
import { validate } from '../../middleware/validate';
import { validateResponse } from '../../middleware/validateResponse';
import {
  transactionsByTradeResponseSchema,
  transactionsByUserResponseSchema,
  transactionTradeIdParamsSchema,
  transactionTradeQuerySchema,
  transactionUserQuerySchema,
} from '../../schemas/transactions';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { safeJsonParse } from '../../utils/safeJson';

const router = express.Router();

// GET /transactions/trade/:id - Get all transactions for a specific trade
router.get(
  '/trade/:id',
  validate({ params: transactionTradeIdParamsSchema, query: transactionTradeQuerySchema }),
  validateResponse(transactionsByTradeResponseSchema),
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { type } = req.query;

    try {
      const tradeResult = await query('SELECT id FROM trades WHERE id = $1', [id]);
      if (tradeResult.length === 0) {
        res.status(404).json({
          error: 'Trade not found',
          details: `No trade found with ID ${id}`,
        });
        return;
      }

      let sql = `
        SELECT
          t.id,
          COALESCE(t.transaction_hash, t.signature) as transaction_hash,
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
          tr.leg1_crypto_token as token_type,
          n.name as network
        FROM
          transactions t
        LEFT JOIN
          trades tr ON t.related_trade_id = tr.id
        LEFT JOIN
          networks n ON t.network_id = n.id
        WHERE
          t.related_trade_id = $1
      `;

      const params: (string | number)[] = [String(id)];
      let paramIndex = 2;

      if (type) {
        sql += ` AND t.type = $${paramIndex}`;
        params.push(type as string);
        paramIndex++;
      }

      sql += ' ORDER BY t.created_at DESC';

      const result = await query(sql, params);

      const transactions = result.map((tx) => {
        let metadata = null;
        if (tx.error_message && tx.status !== 'FAILED') {
          metadata = safeJsonParse(tx.error_message);
          if (metadata !== null) {
            tx.error_message = null;
          }
        }

        return {
          ...tx,
          metadata,
          transaction_type: tx.transaction_type,
        };
      });

      res.json(transactions);
    } catch (err) {
      logError(`Error in /transactions/trade/${id} endpoint`, err as Error);
      res.status(500).json({
        error: (err as Error).message,
        details: 'Error occurred while fetching trade transactions',
      });
    }
  }),
);

// GET /transactions/user - Get all transactions for authenticated user
router.get(
  '/user',
  validate({ query: transactionUserQuerySchema }),
  validateResponse(transactionsByUserResponseSchema),
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const walletAddress = getWalletAddressFromJWT(req);
    const { type, limit, offset } = req.query as { type?: string; limit?: number; offset?: number };

    if (!walletAddress) {
      res.status(401).json({
        error: 'Authentication required',
        details: 'Valid JWT with wallet address is required',
      });
      return;
    }

    try {
      let sql = `
        SELECT
          t.id,
          COALESCE(t.transaction_hash, t.signature) as transaction_hash,
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
          tr.leg1_crypto_token as token_type,
          n.name as network
        FROM
          transactions t
        LEFT JOIN
          trades tr ON t.related_trade_id = tr.id
        LEFT JOIN
          networks n ON t.network_id = n.id
        WHERE
          t.sender_address = $1
      `;

      const params: (string | number)[] = [walletAddress];
      let paramIndex = 2;

      if (type) {
        sql += ` AND t.type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }

      sql += ' ORDER BY t.created_at DESC';
      sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit || 50);
      params.push(offset || 0);

      const result = await query(sql, params);

      const transactions = result.map((tx) => {
        let metadata = null;
        if (tx.error_message && tx.status !== 'FAILED') {
          metadata = safeJsonParse(tx.error_message);
          if (metadata !== null) {
            tx.error_message = null;
          }
        }

        return {
          ...tx,
          metadata,
        };
      });

      res.json(transactions);
    } catch (err) {
      logError(`Error in /transactions/user endpoint for wallet ${walletAddress}`, err as Error);
      res.status(500).json({
        error: (err as Error).message,
        details: 'Error occurred while fetching user transactions',
      });
    }
  }),
);

export default router;
