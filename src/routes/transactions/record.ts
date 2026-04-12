import express, { type Response } from 'express';
import {
  query,
  recordTransaction,
  type TransactionStatus,
  type TransactionType,
  withTransaction,
} from '../../db';
import { logError } from '../../logger';
import { withErrorHandling } from '../../middleware/errorHandler';
import { requireNetwork } from '../../middleware/networkMiddleware';
import { handler } from '../../middleware/typedHandler';
import { validate } from '../../middleware/validate';
import { validateResponse } from '../../middleware/validateResponse';
import {
  recordTransactionRequestSchema,
  recordTransactionResponseSchema,
} from '../../schemas/transactions';
import { isDevMode } from '../../utils/envConfig';
import { safeJsonParse } from '../../utils/safeJson';
import { VALID_LEG_TRANSITIONS } from '../../utils/stateTransitions';

const router = express.Router();

const recordSchemas = { body: recordTransactionRequestSchema } as const;

// Record a new transaction
router.post(
  '/',
  requireNetwork,
  validate({ body: recordTransactionRequestSchema }),
  validateResponse(recordTransactionResponseSchema),
  withErrorHandling(
    handler(recordSchemas, async (req, res: Response): Promise<void> => {
      if (isDevMode) {
        console.log(
          '[DEBUG] /transactions/record endpoint hit with body:',
          JSON.stringify(req.body, null, 2),
        );
      }
      const {
        trade_id,
        escrow_id,
        transaction_hash,
        signature,
        transaction_type,
        from_address,
        to_address,
        block_number,
        metadata,
        status,
      } = req.body;
      const networkId = req.networkId!;

      try {
        // Defensive: If transaction_type is 'OTHER', check metadata for a more specific type
        let finalTransactionType = transaction_type as string;
        if (transaction_type === 'OTHER' && metadata) {
          const metaObj = safeJsonParse<Record<string, unknown>>(metadata, {
            onError: (err) =>
              logError(
                'Failed to parse metadata when inferring transaction type in /transactions/record',
                err,
              ),
          });
          if (metaObj) {
            const actionTypeMap: Record<string, string> = {
              MARK_FIAT_PAID: 'MARK_FIAT_PAID',
              mark_fiat_paid: 'MARK_FIAT_PAID',
            };
            const action = metaObj.action || metaObj.type || metaObj.event;
            if (action && typeof action === 'string' && actionTypeMap[action]) {
              finalTransactionType = actionTypeMap[action];
            }
          }
        }

        let finalFromAddress = from_address;
        let finalToAddress = to_address;

        const metaObj = metadata
          ? safeJsonParse<Record<string, unknown>>(metadata, {
              onError: (err) => logError('Failed to parse metadata for address extraction', err),
            })
          : null;

        if ((!finalFromAddress || finalFromAddress === '') && metaObj) {
          finalFromAddress = (metaObj.seller ||
            metaObj.from ||
            metaObj.sender_address ||
            finalFromAddress) as string;
        }

        if ((!finalToAddress || finalToAddress === '') && metaObj) {
          const extractedAddress = metaObj.buyer || metaObj.to || metaObj.receiver_address;
          if (
            extractedAddress &&
            typeof extractedAddress === 'string' &&
            extractedAddress.length > 10
          ) {
            finalToAddress = extractedAddress;
          }
        }

        if (finalTransactionType === 'FUND_ESCROW' && (!finalToAddress || finalToAddress === '')) {
          finalToAddress = process.env.CONTRACT_ADDRESS;
        }

        const tradeResult = await query('SELECT id FROM trades WHERE id = $1', [trade_id]);
        if (tradeResult.length === 0) {
          console.log(`[ERROR] Trade not found in /transactions/record: trade_id=${trade_id}`);
          res.status(404).json({
            error: 'Trade not found',
            details: `No trade found with ID ${trade_id}`,
          });
          return;
        }

        const escrowDbId = await resolveEscrowDbId(
          escrow_id,
          finalTransactionType,
          trade_id,
          metadata as Record<string, unknown> | undefined,
          networkId,
        );

        const transactionIdentifier = transaction_hash || signature;
        if (isDevMode) {
          console.log(
            `[DEBUG] Recording transaction ${transactionIdentifier} for trade ${trade_id}`,
          );
        }
        const transactionId = await recordTransaction({
          transaction_hash: transaction_hash || undefined,
          signature: signature || undefined,
          status: status as TransactionStatus,
          type: finalTransactionType as TransactionType,
          block_number: block_number || null,
          sender_address: finalFromAddress || null,
          receiver_or_contract_address: finalToAddress || null,
          error_message: status === 'FAILED' && metadata ? JSON.stringify(metadata) : null,
          related_trade_id: trade_id,
          related_escrow_db_id: escrowDbId,
          network_id: networkId,
        });

        console.log(
          `[DB] Recorded/Updated transaction ${transactionIdentifier} with ID: ${transactionId}`,
        );

        await applyStateUpdate(finalTransactionType, trade_id, escrowDbId);

        if (transactionId === null) {
          console.error(
            `[ERROR] Failed to record transaction ${transactionIdentifier} for trade ${trade_id}`,
          );
          res.status(500).json({
            error: 'Failed to record transaction',
            details: 'Database operation failed',
          });
          return;
        }

        res.status(201).json({
          success: true,
          transactionId,
          txHash: transactionIdentifier || '',
          blockNumber: block_number || null,
        });
      } catch (err) {
        const error = err as Error;
        console.error('[ERROR] Exception in /transactions/record endpoint:', error);
        logError(`Error in /transactions/record endpoint for trade ${trade_id}`, error);

        res.status(500).json({
          error: 'Internal server error',
          details: 'Error occurred while recording transaction',
        });
      }
    }),
  ),
);

/**
 * Resolve the database escrow ID from various inputs.
 */
async function resolveEscrowDbId(
  escrow_id: string | number | undefined,
  finalTransactionType: string,
  trade_id: number,
  metadata: Record<string, unknown> | undefined,
  networkId: number,
): Promise<number | null> {
  if (escrow_id) {
    let escrowResult = await query('SELECT id, onchain_escrow_id FROM escrows WHERE id = $1', [
      escrow_id,
    ]);

    if (escrowResult.length === 0) {
      escrowResult = await query(
        'SELECT id, onchain_escrow_id FROM escrows WHERE onchain_escrow_id = $1',
        [escrow_id],
      );

      if (escrowResult.length === 0) {
        const mappingResult = await query(
          'SELECT e.id, e.onchain_escrow_id FROM escrow_id_mapping m JOIN escrows e ON m.database_id = e.id WHERE m.blockchain_id = $1',
          [escrow_id],
        );

        if (mappingResult.length > 0) {
          escrowResult = mappingResult;
        }
      }
    }

    if (escrowResult.length > 0) {
      const escrowDbId = escrowResult[0].id;

      if (
        escrowResult[0].onchain_escrow_id &&
        escrowResult[0].onchain_escrow_id !== escrow_id.toString()
      ) {
        try {
          await query(
            'INSERT INTO escrow_id_mapping (blockchain_id, database_id, network_id) VALUES ($1, $2, $3) ON CONFLICT (blockchain_id, network_id) DO UPDATE SET database_id = $2',
            [escrow_id, escrowDbId, networkId],
          );
        } catch (err) {
          console.log(`[WARN] Could not create escrow ID mapping: ${(err as Error).message}`);
        }
      }
      return escrowDbId;
    }
  }

  if (
    finalTransactionType === 'FUND_ESCROW' &&
    metadata &&
    (metadata as Record<string, unknown>).escrow_id
  ) {
    const metaEscrowId = (metadata as Record<string, unknown>).escrow_id;
    const mappingResult = await query(
      'SELECT database_id FROM escrow_id_mapping WHERE blockchain_id = $1 AND network_id = $2',
      [metaEscrowId, networkId],
    );

    if (mappingResult.length > 0) {
      return mappingResult[0].database_id;
    }

    const escrowResult = await query('SELECT id FROM escrows WHERE onchain_escrow_id = $1', [
      metaEscrowId,
    ]);
    if (escrowResult.length > 0) {
      return escrowResult[0].id;
    }
  }

  if (finalTransactionType === 'FUND_ESCROW') {
    const escrowResult = await query(
      'SELECT id FROM escrows WHERE trade_id = $1 ORDER BY created_at DESC LIMIT 1',
      [trade_id],
    );
    if (escrowResult.length > 0) {
      return escrowResult[0].id;
    }
  }

  return null;
}

/**
 * Apply state updates atomically within a DB transaction.
 */
async function applyStateUpdate(
  transactionType: string,
  trade_id: number,
  escrowDbId: number | null,
): Promise<void> {
  if (transactionType === 'MARK_FIAT_PAID') {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT leg1_state FROM trades WHERE id = $1 FOR UPDATE',
        [trade_id],
      );
      if (rows.length === 0) {
        return;
      }
      const currentState = rows[0].leg1_state;
      if (currentState === 'FIAT_PAID') {
        return;
      }
      if (!VALID_LEG_TRANSITIONS[currentState]?.includes('FIAT_PAID')) {
        console.log(`[WARN] Invalid transition ${currentState} -> FIAT_PAID for trade ${trade_id}`);
        return;
      }
      const timestamp = Math.floor(Date.now() / 1000);
      await client.query(
        'UPDATE trades SET leg1_state = $1, leg1_fiat_paid_at = to_timestamp($2) WHERE id = $3',
        ['FIAT_PAID', timestamp, trade_id],
      );
      if (escrowDbId) {
        await client.query(
          'UPDATE escrows SET fiat_paid = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND fiat_paid = FALSE',
          [escrowDbId],
        );
      }
      console.log(`[INFO] Updated trade id=${trade_id} leg1_state=FIAT_PAID`);
    });
  } else if (transactionType === 'RELEASE_ESCROW') {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT t.leg1_state, t.leg1_escrow_onchain_id, e.id as escrow_id, e.state as escrow_state
         FROM trades t LEFT JOIN escrows e ON e.trade_id = t.id
         WHERE t.id = $1 ORDER BY e.created_at DESC LIMIT 1`,
        [trade_id],
      );
      if (rows.length === 0) {
        return;
      }
      const { leg1_state, escrow_id: foundEscrowId, leg1_escrow_onchain_id } = rows[0];
      if (leg1_state === 'RELEASED' || leg1_state === 'COMPLETED') {
        return;
      }
      if (!VALID_LEG_TRANSITIONS[leg1_state]?.includes('RELEASED')) {
        console.log(`[WARN] Invalid transition ${leg1_state} -> RELEASED for trade ${trade_id}`);
        return;
      }
      const timestamp = Math.floor(Date.now() / 1000);
      await client.query(
        'UPDATE trades SET leg1_state = $1, leg1_released_at = to_timestamp($2), overall_status = $3 WHERE id = $4',
        ['RELEASED', timestamp, 'COMPLETED', trade_id],
      );
      const escrowToUpdate = foundEscrowId || escrowDbId;
      if (escrowToUpdate) {
        await client.query(
          'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($2) WHERE id = $3 AND state <> $1',
          ['RELEASED', timestamp, escrowToUpdate],
        );
      } else if (leg1_escrow_onchain_id) {
        await client.query(
          'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($2) WHERE onchain_escrow_id = $3 AND state <> $1',
          ['RELEASED', timestamp, leg1_escrow_onchain_id],
        );
      }
      console.log(
        `[INFO] Updated trade id=${trade_id} leg1_state=RELEASED overall_status=COMPLETED`,
      );
    });
  } else if (transactionType === 'FUND_ESCROW') {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT leg1_state FROM trades WHERE id = $1 FOR UPDATE',
        [trade_id],
      );
      if (rows.length === 0) {
        return;
      }
      const currentState = rows[0].leg1_state;
      if (['FUNDED', 'FIAT_PAID', 'RELEASED', 'COMPLETED'].includes(currentState)) {
        return;
      }
      if (!VALID_LEG_TRANSITIONS[currentState]?.includes('FUNDED')) {
        console.log(`[WARN] Invalid transition ${currentState} -> FUNDED for trade ${trade_id}`);
        return;
      }
      await client.query('UPDATE trades SET leg1_state = $1 WHERE id = $2', ['FUNDED', trade_id]);
      if (escrowDbId) {
        await client.query(
          'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND state NOT IN ($1, $3, $4, $5)',
          ['FUNDED', escrowDbId, 'FIAT_PAID', 'RELEASED', 'COMPLETED'],
        );
      }
      console.log(`[INFO] Updated trade id=${trade_id} leg1_state=FUNDED`);
    });
  } else if (transactionType === 'CANCEL_ESCROW') {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT leg1_state FROM trades WHERE id = $1 FOR UPDATE',
        [trade_id],
      );
      if (rows.length === 0) {
        return;
      }
      const currentState = rows[0].leg1_state;
      if (currentState === 'CANCELLED') {
        return;
      }
      if (!VALID_LEG_TRANSITIONS[currentState]?.includes('CANCELLED')) {
        console.log(`[WARN] Invalid transition ${currentState} -> CANCELLED for trade ${trade_id}`);
        return;
      }
      const timestamp = Math.floor(Date.now() / 1000);
      await client.query(
        'UPDATE trades SET leg1_state = $1, leg1_cancelled_at = to_timestamp($2), overall_status = $3, cancelled = TRUE WHERE id = $4',
        ['CANCELLED', timestamp, 'CANCELLED', trade_id],
      );
      if (escrowDbId) {
        await client.query(
          'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($2) WHERE id = $3 AND state <> $1',
          ['CANCELLED', timestamp, escrowDbId],
        );
      }
      console.log(`[INFO] Updated trade id=${trade_id} leg1_state=CANCELLED`);
    });
  } else if (transactionType === 'OPEN_DISPUTE' || transactionType === 'DISPUTE_ESCROW') {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT leg1_state FROM trades WHERE id = $1 FOR UPDATE',
        [trade_id],
      );
      if (rows.length === 0) {
        return;
      }
      const currentState = rows[0].leg1_state;
      if (['DISPUTED', 'RESOLVED', 'RELEASED', 'COMPLETED', 'CANCELLED'].includes(currentState)) {
        return;
      }
      if (!VALID_LEG_TRANSITIONS[currentState]?.includes('DISPUTED')) {
        console.log(`[WARN] Invalid transition ${currentState} -> DISPUTED for trade ${trade_id}`);
        return;
      }
      await client.query('UPDATE trades SET leg1_state = $1, overall_status = $2 WHERE id = $3', [
        'DISPUTED',
        'DISPUTED',
        trade_id,
      ]);
      if (escrowDbId) {
        await client.query(
          'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND state NOT IN ($1, $3, $4, $5)',
          ['DISPUTED', escrowDbId, 'RESOLVED', 'RELEASED', 'CANCELLED'],
        );
      }
      console.log(`[INFO] Updated trade id=${trade_id} leg1_state=DISPUTED`);
    });
  } else if (transactionType === 'RESOLVE_DISPUTE') {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT leg1_state FROM trades WHERE id = $1 FOR UPDATE',
        [trade_id],
      );
      if (rows.length === 0) {
        return;
      }
      const currentState = rows[0].leg1_state;
      if (['RESOLVED', 'RELEASED', 'COMPLETED'].includes(currentState)) {
        return;
      }
      if (!VALID_LEG_TRANSITIONS[currentState]?.includes('RESOLVED')) {
        console.log(`[WARN] Invalid transition ${currentState} -> RESOLVED for trade ${trade_id}`);
        return;
      }
      const timestamp = Math.floor(Date.now() / 1000);
      await client.query('UPDATE trades SET leg1_state = $1, overall_status = $2 WHERE id = $3', [
        'RESOLVED',
        'COMPLETED',
        trade_id,
      ]);
      if (escrowDbId) {
        await client.query(
          'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($2) WHERE id = $3 AND state <> $1 AND state <> $4',
          ['RESOLVED', timestamp, escrowDbId, 'RELEASED'],
        );
      }
      console.log(`[INFO] Updated trade id=${trade_id} leg1_state=RESOLVED`);
    });
  }
}

export default router;
