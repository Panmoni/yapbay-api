import express, { Response } from 'express';
import { query, recordTransaction, TransactionType, TransactionStatus } from '../../db';
import { requireNetwork } from '../../middleware/networkMiddleware';
import { withErrorHandling } from '../../middleware/errorHandler';
import { logError } from '../../logger';
import { AuthenticatedRequest } from '../../middleware/auth';
import { validateTransactionRecord } from './validation';

const router = express.Router();

// Record a new transaction
router.post(
  '/',
  requireNetwork,
  validateTransactionRecord,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    console.log(
      '[DEBUG] /transactions/record endpoint hit with body:',
      JSON.stringify(req.body, null, 2)
    );
    const {
      trade_id,
      escrow_id,
      transaction_hash,
      transaction_type,
      from_address,
      to_address,

      block_number,
      metadata,
      status = 'PENDING',
    } = req.body;
    const networkId = req.networkId!;

    try {
      // Defensive: If transaction_type is 'OTHER', check metadata for a more specific type
      let finalTransactionType = transaction_type;
      if (transaction_type === 'OTHER' && metadata) {
        try {
          // Accept both object and stringified JSON
          const metaObj = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
          // Map metadata.action (or similar field) to a specific type
          const actionTypeMap: Record<string, string> = {
            MARK_FIAT_PAID: 'MARK_FIAT_PAID',
            mark_fiat_paid: 'MARK_FIAT_PAID',
            // Add more mappings as needed
          };
          const action = metaObj.action || metaObj.type || metaObj.event;
          if (action && actionTypeMap[action]) {
            finalTransactionType = actionTypeMap[action];
          }
        } catch (e) {
          // Log parse errors for debugging, fallback to 'OTHER'
          logError(
            'Failed to parse metadata when inferring transaction type in /transactions/record',
            e as Error
          );
        }
      }

      // Extract sender/receiver addresses from metadata if not provided directly
      let finalFromAddress = from_address;
      let finalToAddress = to_address;

      // Parse metadata if it's a string
      const metaObj = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

      // Extract sender address from metadata if not provided directly
      if ((!finalFromAddress || finalFromAddress === '') && metaObj) {
        finalFromAddress =
          metaObj.seller || metaObj.from || metaObj.sender_address || finalFromAddress;
        console.log(`[INFO] Extracted sender address from metadata: ${finalFromAddress}`);
      }

      // Extract receiver address from metadata if not provided directly
      if ((!finalToAddress || finalToAddress === '') && metaObj) {
        finalToAddress = metaObj.buyer || metaObj.to || metaObj.receiver_address || finalToAddress;
        console.log(`[INFO] Extracted receiver address from metadata: ${finalToAddress}`);
      }

      // For FUND_ESCROW specifically, use contract address if to_address is missing
      if (finalTransactionType === 'FUND_ESCROW' && (!finalToAddress || finalToAddress === '')) {
        finalToAddress = process.env.CONTRACT_ADDRESS;
        console.log(`[INFO] Using contract address for FUND_ESCROW: ${finalToAddress}`);
      }

      // Verify trade exists
      const tradeResult = await query('SELECT id FROM trades WHERE id = $1', [trade_id]);
      if (tradeResult.length === 0) {
        console.log(`[ERROR] Trade not found in /transactions/record: trade_id=${trade_id}`);
        res.status(404).json({
          error: 'Trade not found',
          details: `No trade found with ID ${trade_id}`,
        });
        return;
      }

      // Verify escrow exists if provided (for FUND_ESCROW, this is required)
      let escrowDbId = null;
      if (escrow_id) {
        // First try to find by database ID
        let escrowResult = await query('SELECT id, onchain_escrow_id FROM escrows WHERE id = $1', [
          escrow_id,
        ]);

        if (escrowResult.length === 0) {
          // If not found by database ID, try to find by blockchain ID
          console.log(
            `[INFO] Escrow not found by database ID ${escrow_id}, trying to find by blockchain ID`
          );
          escrowResult = await query(
            'SELECT id, onchain_escrow_id FROM escrows WHERE onchain_escrow_id = $1',
            [escrow_id]
          );

          if (escrowResult.length === 0) {
            // Try to find using the escrow_id_mapping table
            console.log(
              `[INFO] Trying to find escrow using escrow_id_mapping table with blockchain ID ${escrow_id}`
            );
            const mappingResult = await query(
              'SELECT e.id, e.onchain_escrow_id FROM escrow_id_mapping m JOIN escrows e ON m.database_id = e.id WHERE m.blockchain_id = $1',
              [escrow_id]
            );

            if (mappingResult.length > 0) {
              escrowResult = mappingResult;
              console.log(
                `[INFO] Found escrow via mapping table: blockchain ID ${escrow_id} -> database ID ${escrowResult[0].id}`
              );
            } else {
              console.log(`[WARN] Could not find escrow with ID ${escrow_id} in any table`);
            }
          } else {
            console.log(
              `[INFO] Found escrow by blockchain ID ${escrow_id} -> database ID ${escrowResult[0].id}`
            );
          }
        }

        if (escrowResult.length > 0) {
          escrowDbId = escrowResult[0].id;
          console.log(
            `[INFO] Using escrow database ID ${escrowDbId} for transaction record (provided ID was ${escrow_id})`
          );

          // Create or update mapping if it doesn't exist
          if (
            escrowResult[0].onchain_escrow_id &&
            escrowResult[0].onchain_escrow_id !== escrow_id.toString()
          ) {
            try {
              await query(
                'INSERT INTO escrow_id_mapping (blockchain_id, database_id) VALUES ($1, $2) ON CONFLICT (blockchain_id) DO UPDATE SET database_id = $2',
                [escrow_id, escrowDbId]
              );
              console.log(
                `[INFO] Created/updated ID mapping between blockchain ID ${escrow_id} and database ID ${escrowDbId}`
              );
            } catch (err) {
              console.log(`[WARN] Could not create escrow ID mapping: ${(err as Error).message}`);
            }
          }
        }
      } else if (finalTransactionType === 'FUND_ESCROW' && metadata && metadata.escrow_id) {
        // Special case: For FUND_ESCROW, try to get escrow ID from metadata if not provided directly
        console.log(
          `[INFO] FUND_ESCROW transaction without direct escrow_id, using escrow_id=${metadata.escrow_id} from metadata`
        );

        // First check the mapping table
        let mappingResult = await query(
          'SELECT database_id FROM escrow_id_mapping WHERE blockchain_id = $1',
          [metadata.escrow_id]
        );

        if (mappingResult.length > 0) {
          escrowDbId = mappingResult[0].database_id;
          console.log(
            `[INFO] Found escrow via mapping table: blockchain ID ${metadata.escrow_id} -> database ID ${escrowDbId}`
          );
        } else {
          // Try to find by onchain_escrow_id
          const escrowResult = await query('SELECT id FROM escrows WHERE onchain_escrow_id = $1', [
            metadata.escrow_id,
          ]);
          if (escrowResult.length > 0) {
            escrowDbId = escrowResult[0].id;
            console.log(
              `[INFO] Found escrow by blockchain ID ${metadata.escrow_id} -> database ID ${escrowDbId}`
            );

            // Create mapping for future use
            try {
              await query(
                'INSERT INTO escrow_id_mapping (blockchain_id, database_id) VALUES ($1, $2) ON CONFLICT (blockchain_id) DO UPDATE SET database_id = $2',
                [metadata.escrow_id, escrowDbId]
              );
              console.log(
                `[INFO] Created ID mapping between blockchain ID ${metadata.escrow_id} and database ID ${escrowDbId}`
              );
            } catch (err) {
              console.log(`[WARN] Could not create escrow ID mapping: ${(err as Error).message}`);
            }
          } else {
            console.log(
              `[WARN] Could not find escrow with onchain_escrow_id ${metadata.escrow_id} from metadata`
            );
            // We'll continue without the escrow ID, but log a warning
          }
        }
      } else if (finalTransactionType === 'FUND_ESCROW') {
        // For FUND_ESCROW, we really should have an escrow ID
        console.log(
          `[WARN] FUND_ESCROW transaction without escrow_id, attempting to find by trade_id`
        );

        // Try to find the most recent escrow for this trade
        const escrowResult = await query(
          'SELECT id, onchain_escrow_id FROM escrows WHERE trade_id = $1 ORDER BY created_at DESC LIMIT 1',
          [trade_id]
        );

        if (escrowResult.length > 0) {
          escrowDbId = escrowResult[0].id;
          console.log(
            `[INFO] Found most recent escrow for trade ${trade_id} -> database ID ${escrowDbId}`
          );

          // If we have an onchain_escrow_id, create a mapping for future use
          if (escrowResult[0].onchain_escrow_id) {
            try {
              await query(
                'INSERT INTO escrow_id_mapping (blockchain_id, database_id) VALUES ($1, $2) ON CONFLICT (blockchain_id) DO UPDATE SET database_id = $2',
                [escrowResult[0].onchain_escrow_id, escrowDbId]
              );
              console.log(
                `[INFO] Created ID mapping between blockchain ID ${escrowResult[0].onchain_escrow_id} and database ID ${escrowDbId}`
              );
            } catch (err) {
              console.log(`[WARN] Could not create escrow ID mapping: ${(err as Error).message}`);
            }
          }
        } else {
          console.log(`[WARN] Could not find any escrow for trade ${trade_id}`);
          // We'll continue without the escrow ID, but log a warning
        }
      }

      // Record the transaction
      console.log(`[DEBUG] Recording transaction ${transaction_hash} for trade ${trade_id}`);
      const transactionId = await recordTransaction({
        transaction_hash,
        status: status as TransactionStatus,
        type: finalTransactionType as TransactionType,
        block_number: block_number || null,
        sender_address: finalFromAddress || null,
        receiver_or_contract_address: finalToAddress || null,
        error_message: metadata ? JSON.stringify(metadata) : null,
        related_trade_id: trade_id,
        related_escrow_db_id: escrowDbId,
        network_id: networkId,
      });

      console.log(
        `[DB] Recorded/Updated transaction ${transaction_hash} with ID: ${transactionId}`
      );

      // Handle state updates based on transaction type
      if (finalTransactionType === 'MARK_FIAT_PAID') {
        try {
          // Get current trade state
          const tradeResult = await query('SELECT leg1_state FROM trades WHERE id = $1', [
            trade_id,
          ]);

          if (tradeResult.length === 0) {
            console.log(`[WARN] Cannot update trade state: Trade with ID ${trade_id} not found`);
          } else if (tradeResult[0].leg1_state !== 'FIAT_PAID') {
            // Update trade leg1_state to FIAT_PAID
            const timestamp = Math.floor(Date.now() / 1000);
            await query(
              'UPDATE trades SET leg1_state = $1, leg1_fiat_paid_at = to_timestamp($2) WHERE id = $3 AND leg1_state <> $1',
              ['FIAT_PAID', timestamp, trade_id]
            );
            console.log(`[INFO] Updated trade id=${trade_id} leg1_state=FIAT_PAID`);

            // Also update escrow fiat_paid status if we have an escrow ID
            if (escrowDbId) {
              await query(
                'UPDATE escrows SET fiat_paid = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND fiat_paid = FALSE',
                [escrowDbId]
              );
              console.log(`[INFO] Updated escrow id=${escrowDbId} fiat_paid=TRUE`);
            }
          } else {
            console.log(
              `[INFO] Trade id=${trade_id} already in leg1_state=FIAT_PAID, skipping update`
            );
          }
        } catch (err) {
          console.error(
            `[ERROR] Failed to update trade state for MARK_FIAT_PAID: ${(err as Error).message}`
          );
          // Continue with the response even if state update fails
        }
      }
      // Handle RELEASE_ESCROW transaction type
      else if (finalTransactionType === 'RELEASE_ESCROW') {
        try {
          // Get current trade state and escrow info
          const tradeResult = await query(
            'SELECT t.leg1_state, t.leg1_escrow_onchain_id, e.id as escrow_id, e.state as escrow_state ' +
              'FROM trades t ' +
              'LEFT JOIN escrows e ON e.trade_id = t.id ' +
              'WHERE t.id = $1 ' +
              'ORDER BY e.created_at DESC LIMIT 1',
            [trade_id]
          );

          if (tradeResult.length === 0) {
            console.log(`[WARN] Cannot update trade state: Trade with ID ${trade_id} not found`);
          } else {
            const { leg1_state, escrow_id, escrow_state, leg1_escrow_onchain_id } = tradeResult[0];

            // Only update if not already in RELEASED or COMPLETED state
            if (leg1_state !== 'RELEASED' && leg1_state !== 'COMPLETED') {
              // Update trade leg1_state to RELEASED
              const timestamp = Math.floor(Date.now() / 1000);
              await query(
                'UPDATE trades SET leg1_state = $1, leg1_released_at = to_timestamp($2), overall_status = $3 WHERE id = $4 AND leg1_state <> $1 AND leg1_state <> $5',
                ['RELEASED', timestamp, 'COMPLETED', trade_id, 'COMPLETED']
              );
              console.log(
                `[INFO] Updated trade id=${trade_id} leg1_state=RELEASED overall_status=COMPLETED`
              );

              // Also update escrow state if we have an escrow ID
              if (escrow_id && escrow_state !== 'RELEASED') {
                await query(
                  'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($2) WHERE id = $3 AND state <> $1',
                  ['RELEASED', timestamp, escrow_id]
                );
                console.log(`[INFO] Updated escrow id=${escrow_id} state=RELEASED`);
              }

              // If we have the onchain escrow ID but not the database ID, try to update by onchain ID
              if (leg1_escrow_onchain_id && !escrow_id) {
                await query(
                  'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($2) WHERE onchain_escrow_id = $3 AND state <> $1',
                  ['RELEASED', timestamp, leg1_escrow_onchain_id]
                );
                console.log(
                  `[INFO] Updated escrow with onchain_id=${leg1_escrow_onchain_id} state=RELEASED`
                );
              }

              // If we have the escrow database ID from the request but it's different from what we found
              if (escrowDbId && escrowDbId !== escrow_id) {
                await query(
                  'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($2) WHERE id = $3 AND state <> $1',
                  ['RELEASED', timestamp, escrowDbId]
                );
                console.log(`[INFO] Updated escrow id=${escrowDbId} state=RELEASED (from request)`);
              }
            } else {
              console.log(
                `[INFO] Trade id=${trade_id} already in leg1_state=${leg1_state}, skipping update`
              );
            }
          }
        } catch (err) {
          console.error(
            `[ERROR] Failed to update trade state for RELEASE_ESCROW: ${(err as Error).message}`
          );
          // Continue with the response even if state update fails
        }
      }
      // Handle FUND_ESCROW transaction type
      else if (finalTransactionType === 'FUND_ESCROW') {
        try {
          // Get current trade state
          const tradeResult = await query('SELECT leg1_state FROM trades WHERE id = $1', [
            trade_id,
          ]);

          if (tradeResult.length === 0) {
            console.log(`[WARN] Cannot update trade state: Trade with ID ${trade_id} not found`);
          } else if (
            tradeResult[0].leg1_state !== 'FUNDED' &&
            tradeResult[0].leg1_state !== 'FIAT_PAID' &&
            tradeResult[0].leg1_state !== 'RELEASED' &&
            tradeResult[0].leg1_state !== 'COMPLETED'
          ) {
            // Update trade leg1_state to FUNDED only if it's in a state before FUNDED
            await query(
              'UPDATE trades SET leg1_state = $1 WHERE id = $2 AND (leg1_state IS NULL OR leg1_state = $3)',
              ['FUNDED', trade_id, 'CREATED']
            );
            console.log(`[INFO] Updated trade id=${trade_id} leg1_state=FUNDED`);

            // Also update escrow state if we have an escrow ID
            if (escrowDbId) {
              await query(
                'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND state <> $1 AND state <> $3 AND state <> $4 AND state <> $5',
                ['FUNDED', escrowDbId, 'FIAT_PAID', 'RELEASED', 'COMPLETED']
              );
              console.log(`[INFO] Updated escrow id=${escrowDbId} state=FUNDED`);
            }
          } else {
            console.log(
              `[INFO] Trade id=${trade_id} already in leg1_state=${tradeResult[0].leg1_state}, skipping update to FUNDED`
            );
          }
        } catch (err) {
          console.error(
            `[ERROR] Failed to update trade state for FUND_ESCROW: ${(err as Error).message}`
          );
          // Continue with the response even if state update fails
        }
      }
      // Handle CANCEL_ESCROW transaction type
      else if (finalTransactionType === 'CANCEL_ESCROW') {
        try {
          // Get current trade state
          const tradeResult = await query('SELECT leg1_state FROM trades WHERE id = $1', [
            trade_id,
          ]);

          if (tradeResult.length === 0) {
            console.log(`[WARN] Cannot update trade state: Trade with ID ${trade_id} not found`);
          } else if (tradeResult[0].leg1_state !== 'CANCELLED') {
            // Update trade leg1_state to CANCELLED
            const timestamp = Math.floor(Date.now() / 1000);
            await query(
              'UPDATE trades SET leg1_state = $1, leg1_cancelled_at = to_timestamp($2), overall_status = $3, cancelled = TRUE WHERE id = $4 AND leg1_state <> $1',
              ['CANCELLED', timestamp, 'CANCELLED', trade_id]
            );
            console.log(
              `[INFO] Updated trade id=${trade_id} leg1_state=CANCELLED overall_status=CANCELLED`
            );

            // Also update escrow state if we have an escrow ID
            if (escrowDbId) {
              await query(
                'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($2) WHERE id = $3 AND state <> $1',
                ['CANCELLED', timestamp, escrowDbId]
              );
              console.log(`[INFO] Updated escrow id=${escrowDbId} state=CANCELLED`);
            }
          } else {
            console.log(
              `[INFO] Trade id=${trade_id} already in leg1_state=CANCELLED, skipping update`
            );
          }
        } catch (err) {
          console.error(
            `[ERROR] Failed to update trade state for CANCEL_ESCROW: ${(err as Error).message}`
          );
          // Continue with the response even if state update fails
        }
      }
      // Handle OPEN_DISPUTE transaction type
      else if (
        finalTransactionType === 'OPEN_DISPUTE' ||
        finalTransactionType === 'DISPUTE_ESCROW'
      ) {
        try {
          // Get current trade state
          const tradeResult = await query('SELECT leg1_state FROM trades WHERE id = $1', [
            trade_id,
          ]);

          if (tradeResult.length === 0) {
            console.log(`[WARN] Cannot update trade state: Trade with ID ${trade_id} not found`);
          } else if (
            tradeResult[0].leg1_state !== 'DISPUTED' &&
            tradeResult[0].leg1_state !== 'RESOLVED' &&
            tradeResult[0].leg1_state !== 'RELEASED' &&
            tradeResult[0].leg1_state !== 'COMPLETED' &&
            tradeResult[0].leg1_state !== 'CANCELLED'
          ) {
            // Update trade leg1_state to DISPUTED
            await query(
              'UPDATE trades SET leg1_state = $1, overall_status = $2 WHERE id = $3 AND leg1_state <> $1',
              ['DISPUTED', 'DISPUTED', trade_id]
            );
            console.log(
              `[INFO] Updated trade id=${trade_id} leg1_state=DISPUTED overall_status=DISPUTED`
            );

            // Also update escrow state if we have an escrow ID
            if (escrowDbId) {
              await query(
                'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND state <> $1 AND state <> $3 AND state <> $4 AND state <> $5',
                ['DISPUTED', escrowDbId, 'RESOLVED', 'RELEASED', 'CANCELLED']
              );
              console.log(`[INFO] Updated escrow id=${escrowDbId} state=DISPUTED`);
            }
          } else {
            console.log(
              `[INFO] Trade id=${trade_id} already in leg1_state=${tradeResult[0].leg1_state}, skipping update to DISPUTED`
            );
          }
        } catch (err) {
          console.error(
            `[ERROR] Failed to update trade state for OPEN_DISPUTE: ${(err as Error).message}`
          );
          // Continue with the response even if state update fails
        }
      }
      // Handle RESOLVE_DISPUTE transaction type
      else if (finalTransactionType === 'RESOLVE_DISPUTE') {
        try {
          // Get current trade state
          const tradeResult = await query('SELECT leg1_state FROM trades WHERE id = $1', [
            trade_id,
          ]);

          if (tradeResult.length === 0) {
            console.log(`[WARN] Cannot update trade state: Trade with ID ${trade_id} not found`);
          } else if (
            tradeResult[0].leg1_state !== 'RESOLVED' &&
            tradeResult[0].leg1_state !== 'RELEASED' &&
            tradeResult[0].leg1_state !== 'COMPLETED'
          ) {
            // Update trade leg1_state to RESOLVED
            const timestamp = Math.floor(Date.now() / 1000);
            await query(
              'UPDATE trades SET leg1_state = $1, overall_status = $2 WHERE id = $3 AND leg1_state <> $1',
              ['RESOLVED', 'COMPLETED', trade_id]
            );
            console.log(
              `[INFO] Updated trade id=${trade_id} leg1_state=RESOLVED overall_status=COMPLETED`
            );

            // Also update escrow state if we have an escrow ID
            if (escrowDbId) {
              await query(
                'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($2) WHERE id = $3 AND state <> $1 AND state <> $4',
                ['RESOLVED', timestamp, escrowDbId, 'RELEASED']
              );
              console.log(`[INFO] Updated escrow id=${escrowDbId} state=RESOLVED`);
            }
          } else {
            console.log(
              `[INFO] Trade id=${trade_id} already in leg1_state=${tradeResult[0].leg1_state}, skipping update to RESOLVED`
            );
          }
        } catch (err) {
          console.error(
            `[ERROR] Failed to update trade state for RESOLVE_DISPUTE: ${(err as Error).message}`
          );
          // Continue with the response even if state update fails
        }
      }

      if (transactionId === null) {
        console.error(
          `[ERROR] Failed to record transaction ${transaction_hash} for trade ${trade_id}`
        );
        res.status(500).json({
          error: 'Failed to record transaction',
          details: 'Database operation failed',
        });
        return;
      }

      console.log(
        `[DEBUG] Successfully recorded transaction ${transaction_hash} with ID: ${transactionId}`
      );
      res.status(201).json({
        success: true,
        transactionId,
        txHash: transaction_hash,
        blockNumber: block_number || null,
      });
    } catch (err) {
      const error = err as Error;
      console.error(`[ERROR] Exception in /transactions/record endpoint:`, error);
      logError(`Error in /transactions/record endpoint for trade ${trade_id}`, error);

      // Provide more detailed error information
      const errorDetails = {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        trade_id,
        transaction_hash,
        transaction_type,
      };

      res.status(500).json({
        error: error.message,
        details: 'Error occurred while recording transaction',
        errorInfo: errorDetails,
      });
    }
  })
);

export default router;
