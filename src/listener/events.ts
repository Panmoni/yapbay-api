import * as dotenv from 'dotenv';
import { CeloService } from '../celo';
import { NetworkService } from '../services/networkService';
import { query, recordTransaction, TransactionType } from '../db';
import type { LogDescription, ParamType } from 'ethers';
import fs from 'fs';
import path from 'path';
import pool from '../db';

dotenv.config();

// This file is deprecated - use multiNetworkEvents.ts instead
// Keeping for backward compatibility only

const logFilePath = path.join(process.cwd(), 'events.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function fileLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  logStream.write(line);
}

// Typed representation of chain log with necessary fields
interface ContractLog {
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  topics: string[];
  data: string;
}

export async function startEventListener() {
  console.log('⚠️  WARNING: This is the legacy single-network event listener.');
  console.log('⚠️  Please use multiNetworkEvents.ts for production.');
  
  const defaultNetwork = await NetworkService.getDefaultNetwork();
  const wsProvider = await CeloService.getWsProviderForNetwork(defaultNetwork.id);
  const contract = await CeloService.getContractForNetwork(defaultNetwork.id, wsProvider);
  
  console.log('Starting contract event listener for', defaultNetwork.contractAddress);
  fileLog(`Starting contract event listener for ${defaultNetwork.contractAddress}`);

  // Listen to all logs from this contract
  const filter = { address: defaultNetwork.contractAddress };

  wsProvider.on(filter, async (log: ContractLog) => {
    try {
      const parsed = contract.interface.parseLog(log) as LogDescription;
      if (!parsed) return;
      // Build args object
      const argsObj: Record<string, unknown> = {};
      parsed.fragment.inputs.forEach((input: ParamType, idx: number) => {
        const raw = parsed.args[idx];
        argsObj[input.name] = typeof raw === 'bigint' ? raw.toString() : raw;
      });
      const tradeIdValue =
        parsed.args.tradeId !== undefined ? Number(parsed.args.tradeId.toString()) : null;

      const insertSql = `
        INSERT INTO contract_events
          (event_name, block_number, transaction_hash, log_index, args, trade_id, transaction_id)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        ON CONFLICT DO NOTHING;
      `;
      // All blockchain events use EVENT transaction type
      const transactionType: TransactionType = 'EVENT';

      let senderAddress = null;
      let receiverAddress = null;
      
      // Extract sender and receiver addresses based on event type
      switch (parsed.name) {
        case 'EscrowCreated':
          senderAddress = parsed.args.seller as string;
          receiverAddress = defaultNetwork.contractAddress;
          break;
        case 'FundsDeposited':
          senderAddress = parsed.args.depositor as string;
          receiverAddress = defaultNetwork.contractAddress;
          break;
        case 'FiatMarkedPaid':
          senderAddress = parsed.args.buyer as string;
          receiverAddress = parsed.args.seller as string;
          break;
        case 'EscrowReleased':
          senderAddress = parsed.args.releaser as string;
          receiverAddress = parsed.args.seller as string;
          break;
        case 'EscrowCancelled':
          senderAddress = parsed.args.canceller as string;
          receiverAddress = parsed.args.buyer as string;
          break;
        case 'EscrowBalanceChanged':
          senderAddress = defaultNetwork.contractAddress;
          receiverAddress = defaultNetwork.contractAddress;
          break;
        // Add other cases as needed
      }
      
      // Create metadata object to store in error_message field
      const metadataObj: Record<string, unknown> = {};
      
      // Add relevant fields to metadata based on event type
      if (parsed.name === 'EscrowCreated' || parsed.name === 'FundsDeposited' || 
          parsed.name === 'FiatMarkedPaid' || parsed.name === 'EscrowReleased' || 
          parsed.name === 'EscrowCancelled') {
        metadataObj.escrow_id = parsed.args.escrowId?.toString();
        
        if (parsed.args.seller) metadataObj.seller = parsed.args.seller;
        if (parsed.args.buyer) metadataObj.buyer = parsed.args.buyer;
      }
      
      const transactionId = await recordTransaction({
        transaction_hash: log.transactionHash,
        status: 'SUCCESS',
        type: transactionType,
        block_number: log.blockNumber,
        sender_address: senderAddress,
        receiver_or_contract_address: receiverAddress,
        error_message: Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : null,
        related_trade_id: tradeIdValue,
        network_id: defaultNetwork.id,
      });

      // Ensure log_index is never null (use 0 as default if missing)
      const logIndex = log.logIndex !== undefined ? log.logIndex : 0;

      const params = [
        parsed.name,
        log.blockNumber,
        log.transactionHash,
        logIndex,
        JSON.stringify(argsObj),
        tradeIdValue,
        transactionId,
      ];

      await query(insertSql, params);
      console.log(
        `Logged event ${parsed.name} tx=${
          log.transactionHash
        } logIndex=${logIndex} args=${JSON.stringify(argsObj)}`
      );
      fileLog(
        `Logged event ${parsed.name} tx=${
          log.transactionHash
        } logIndex=${logIndex} args=${JSON.stringify(argsObj)}`
      );

      // Sync normalized escrow & trade state
      switch (parsed.name) {
        case 'EscrowCreated': {
          const escrowId = parsed.args.escrowId.toString();
          const tradeId = Number(parsed.args.tradeId.toString());
          const seller = parsed.args.seller as string;
          const buyer = parsed.args.buyer as string;
          const arbitrator = parsed.args.arbitrator as string;
          const amount = parsed.args.amount.toString();
          // Convert blockchain amount (with 6 decimals) to database decimal format
          const _amountInDecimal = Number(amount) / 1_000_000;
          const depositTs = Number(parsed.args.deposit_deadline.toString());
          const fiatTs = Number(parsed.args.fiat_deadline.toString());
          const depositDate = new Date(depositTs * 1000);
          const fiatDate = new Date(fiatTs * 1000);
          const sequential = parsed.args.sequential as boolean;
          const seqAddr = parsed.args.sequentialEscrowAddress as string;

          // Check if this escrow already exists in the database
          const existingEscrow = await query('SELECT id, state FROM escrows WHERE onchain_escrow_id = $1', [
            escrowId,
          ]);

          if (existingEscrow.length > 0) {
            // Escrow already exists - update it if needed but don't create a duplicate
            // Only update if it's not in a terminal state
            if (!['RELEASED', 'CANCELLED', 'RESOLVED'].includes(existingEscrow[0].state)) {
              await query(
                'UPDATE escrows SET deposit_deadline = $1, fiat_deadline = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                [depositDate, fiatDate, existingEscrow[0].id]
              );
              console.log(
                `EscrowCreated: Updated existing escrow id=${
                  existingEscrow[0].id
                } deposit_deadline=${depositDate.toISOString()} fiat_deadline=${fiatDate.toISOString()}`
              );
              fileLog(
                `EscrowCreated: Updated existing escrow id=${
                  existingEscrow[0].id
                } deposit_deadline=${depositDate.toISOString()} fiat_deadline=${fiatDate.toISOString()}`
              );
            } else {
              console.log(
                `EscrowCreated: Escrow onchainId=${escrowId} already exists in terminal state ${existingEscrow[0].state}. No update needed.`
              );
              fileLog(
                `EscrowCreated: Escrow onchainId=${escrowId} already exists in terminal state ${existingEscrow[0].state}. No update needed.`
              );
            }
          } else {
            // Insert new escrow record
            const insertResult = await query(
              'INSERT INTO escrows (trade_id, escrow_address, onchain_escrow_id, seller_address, buyer_address, arbitrator_address, amount, current_balance, state, sequential, sequential_escrow_address, deposit_deadline, fiat_deadline, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $13) RETURNING id',
              [
                tradeId,
                defaultNetwork.contractAddress,
                escrowId,
                seller,
                buyer,
                arbitrator,
                _amountInDecimal,
                'CREATED',
                sequential,
                seqAddr,
                depositDate,
                fiatDate,
                defaultNetwork.id,
              ]
            );

            const newEscrowId = insertResult[0]?.id;
            console.log(
              `EscrowCreated: Inserted escrow onchainId=${escrowId} for tradeId=${tradeId} with database ID=${newEscrowId}`
            );
            fileLog(`EscrowCreated: Inserted escrow onchainId=${escrowId} for tradeId=${tradeId} with database ID=${newEscrowId}`);

            // Create a mapping record to help with ID synchronization
            await query(
              'INSERT INTO escrow_id_mapping (blockchain_id, database_id) VALUES ($1, $2) ON CONFLICT (blockchain_id) DO UPDATE SET database_id = $2',
              [escrowId, newEscrowId]
            );
            console.log(`EscrowCreated: Created ID mapping between blockchain ID ${escrowId} and database ID ${newEscrowId}`);
            fileLog(`EscrowCreated: Created ID mapping between blockchain ID ${escrowId} and database ID ${newEscrowId}`);
          }

          // Update trade leg state - only if not already in a later state
          await query(
            'UPDATE trades SET leg1_state = $1, leg1_escrow_onchain_id = $2 WHERE id = $3 AND (leg1_state IS NULL OR leg1_state = $4)',
            ['CREATED', escrowId, tradeId, 'CREATED']
          );
          console.log(
            `EscrowCreated: Updated trade id=${tradeId} leg1_state=CREATED onchainEscrowId=${escrowId}`
          );
          fileLog(
            `EscrowCreated: Updated trade id=${tradeId} leg1_state=CREATED onchainEscrowId=${escrowId}`
          );
          break;
        }
        case 'FiatMarkedPaid': {
          const escrowId = parsed.args.escrowId.toString();
          const tradeId = Number(parsed.args.tradeId.toString());
          const timestamp = Number(parsed.args.timestamp.toString());

          try {
            // Get current escrow and trade state to ensure proper transitions
            const escrowResult = await query(
              'SELECT state, fiat_paid FROM escrows WHERE onchain_escrow_id = $1',
              [escrowId]
            );
            
            const tradeResult = await query(
              'SELECT leg1_state FROM trades WHERE id = $1',
              [tradeId]
            );
            
            // Validate that escrow exists
            if (escrowResult.length === 0) {
              console.error(`FiatMarkedPaid: Escrow with onchain ID ${escrowId} not found in database`);
              fileLog(`FiatMarkedPaid: Escrow with onchain ID ${escrowId} not found in database`);
              
              // Try to create a mapping record if it exists in another form
              const alternateEscrow = await query(
                'SELECT id FROM escrows WHERE trade_id = $1 ORDER BY created_at DESC LIMIT 1',
                [tradeId]
              );
              
              if (alternateEscrow.length > 0) {
                try {
                  await query(
                    'INSERT INTO escrow_id_mapping (blockchain_id, database_id) VALUES ($1, $2) ON CONFLICT (blockchain_id) DO UPDATE SET database_id = $2',
                    [escrowId, alternateEscrow[0].id]
                  );
                  console.log(`FiatMarkedPaid: Created recovery mapping between blockchain ID ${escrowId} and database ID ${alternateEscrow[0].id}`);
                  fileLog(`FiatMarkedPaid: Created recovery mapping between blockchain ID ${escrowId} and database ID ${alternateEscrow[0].id}`);
                } catch (err) {
                  console.error(`FiatMarkedPaid: Failed to create recovery mapping: ${(err as Error).message}`);
                  fileLog(`FiatMarkedPaid: Failed to create recovery mapping: ${(err as Error).message}`);
                }
              }
            } else {
              // Only update if not already marked as paid
              if (!escrowResult[0].fiat_paid) {
                // Update escrow fiat_paid status
                await query(
                  'UPDATE escrows SET fiat_paid = TRUE, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $1 AND fiat_paid = FALSE',
                  [escrowId]
                );
                console.log(`FiatMarkedPaid: Updated escrow onchainId=${escrowId} fiat_paid=TRUE`);
                fileLog(`FiatMarkedPaid: Updated escrow onchainId=${escrowId} fiat_paid=TRUE`);
              } else {
                console.log(`FiatMarkedPaid: Escrow onchainId=${escrowId} already marked as fiat_paid=TRUE, skipping update`);
                fileLog(`FiatMarkedPaid: Escrow onchainId=${escrowId} already marked as fiat_paid=TRUE, skipping update`);
              }
            }
            
            // Validate that trade exists
            if (tradeResult.length === 0) {
              console.error(`FiatMarkedPaid: Trade with ID ${tradeId} not found in database`);
              fileLog(`FiatMarkedPaid: Trade with ID ${tradeId} not found in database`);
            } else {
              // Only update if not already in FIAT_PAID state
              if (tradeResult[0].leg1_state !== 'FIAT_PAID') {
                // Update trade leg1_state to FIAT_PAID
                await query(
                  'UPDATE trades SET leg1_state = $1, leg1_fiat_paid_at = to_timestamp($2) WHERE id = $3 AND leg1_state <> $1',
                  ['FIAT_PAID', timestamp, tradeId]
                );
                console.log(`FiatMarkedPaid: Updated trade id=${tradeId} leg1_state=FIAT_PAID`);
                fileLog(`FiatMarkedPaid: Updated trade id=${tradeId} leg1_state=FIAT_PAID`);
              } else {
                console.log(`FiatMarkedPaid: Trade id=${tradeId} already in leg1_state=FIAT_PAID, skipping update`);
                fileLog(`FiatMarkedPaid: Trade id=${tradeId} already in leg1_state=FIAT_PAID, skipping update`);
              }
            }
            
            // Record this event in a dedicated transaction record for better tracking
            try {
              await recordTransaction({
                transaction_hash: log.transactionHash,
                status: 'SUCCESS',
                type: 'MARK_FIAT_PAID',
                block_number: log.blockNumber,
                related_trade_id: tradeId,
                sender_address: parsed.args.buyer,
                receiver_or_contract_address: parsed.args.seller,
                error_message: JSON.stringify({ escrow_id: escrowId, timestamp }),
                network_id: defaultNetwork.id
              });
              console.log(`FiatMarkedPaid: Recorded transaction record for tx=${log.transactionHash}`);
              fileLog(`FiatMarkedPaid: Recorded transaction record for tx=${log.transactionHash}`);
            } catch (err) {
              console.error(`FiatMarkedPaid: Failed to record transaction: ${(err as Error).message}`);
              fileLog(`FiatMarkedPaid: Failed to record transaction: ${(err as Error).message}`);
            }
          } catch (err) {
            console.error(`FiatMarkedPaid: Error processing event: ${(err as Error).message}`);
            fileLog(`FiatMarkedPaid: Error processing event: ${(err as Error).message}`);
            
            // Attempt to record the error
            try {
              // Record a more detailed error transaction
              await recordTransaction({
                transaction_hash: log.transactionHash,
                status: 'FAILED',
                type: 'EVENT',
                block_number: log.blockNumber,
                related_trade_id: null,
                error_message: `Event listener error: ${(err as Error).message || 'Unknown error'}`,
                network_id: defaultNetwork.id,
              });

              console.log(`[RECOVERY] Recorded error transaction for ${log.transactionHash}`);
              fileLog(`[RECOVERY] Recorded error transaction for ${log.transactionHash}`);
            } catch (recordErr) {
              // If even the error recording fails, just log it without further action
              console.error('Failed to record error transaction:', recordErr);
              fileLog(`Failed to record error transaction: ${recordErr}`);
            }
          }
          
          break;
        }
        case 'FundsDeposited': {
          const escrowId = parsed.args.escrowId.toString();
          const counter = parsed.args.counter.toString();
          const amount = parsed.args.amount.toString();

          // Convert blockchain amount (with 6 decimals) to database decimal format
          const amountInDecimal = Number(amount) / 1_000_000;

          // Update the escrow state and balance
          await query(
            'UPDATE escrows SET state = $1, counter = $2, current_balance = $3, updated_at = CURRENT_TIMESTAMP, sequential = $4 WHERE onchain_escrow_id = $5',
            ['FUNDED', counter, amountInDecimal, false, escrowId]
          );
          console.log(`FundsDeposited: Updated escrow onchainId=${escrowId} state=FUNDED current_balance=${amountInDecimal}`);
          fileLog(`FundsDeposited: Updated escrow onchainId=${escrowId} state=FUNDED current_balance=${amountInDecimal}`);

          // Update the trade state
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['FUNDED', escrowId]
          );
          console.log(`FundsDeposited: Updated trade leg1_state=FUNDED for escrowId=${escrowId}`);
          fileLog(`FundsDeposited: Updated trade leg1_state=FUNDED for escrowId=${escrowId}`);
          break;
        }
        case 'EscrowReleased': {
          const escrowId = parsed.args.escrowId.toString();
          const timestamp = parsed.args.timestamp.toString();

          // Update the escrow state and set balance to 0 (funds released)
          await query(
            'UPDATE escrows SET state = $1, current_balance = $2, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($3) WHERE onchain_escrow_id = $4',
            ['RELEASED', 0, timestamp, escrowId]
          );
          console.log(`EscrowReleased: Updated escrow onchainId=${escrowId} state=RELEASED current_balance=0`);
          fileLog(`EscrowReleased: Updated escrow onchainId=${escrowId} state=RELEASED current_balance=0`);

          // Update the trade state
          await query(
            'UPDATE trades SET leg1_state = $1, leg1_released_at = to_timestamp($2), overall_status = $3 WHERE leg1_escrow_onchain_id = $4 AND leg1_state <> $1',
            ['RELEASED', timestamp, 'COMPLETED', escrowId]
          );
          console.log(`EscrowReleased: Updated trade leg1_state=RELEASED overall_status=COMPLETED for escrowId=${escrowId}`);
          fileLog(`EscrowReleased: Updated trade leg1_state=RELEASED overall_status=COMPLETED for escrowId=${escrowId}`);
          break;
        }
        case 'EscrowCancelled': {
          const escrowId = parsed.args.escrowId.toString();
          const timestamp = Number(parsed.args.timestamp?.toString() || Math.floor(Date.now() / 1000));
          
          // Check if this was an auto-cancellation by examining the transaction
          const txHash = log.transactionHash;
          const arbitratorAddress = process.env.ARBITRATOR_ADDRESS;
          let isAutoCancellation = false;
          
          try {
            // Check if this cancellation was triggered by our monitoring service
            const autoCancelResult = await pool.query(
              'SELECT id FROM contract_auto_cancellations WHERE escrow_id = $1 AND transaction_hash = $2',
              [escrowId, txHash]
            );
            
            if (autoCancelResult.rows.length > 0) {
              isAutoCancellation = true;
              console.log(`EscrowCancelled: Detected auto-cancellation for escrow ${escrowId}`);
              fileLog(`EscrowCancelled: Detected auto-cancellation for escrow ${escrowId}`);
            } else if (arbitratorAddress && parsed.args.canceller === arbitratorAddress) {
              // If cancelled by arbitrator address but not found in our records, likely an auto-cancellation
              isAutoCancellation = true;
              console.log(`EscrowCancelled: Detected likely auto-cancellation by arbitrator for escrow ${escrowId}`);
              fileLog(`EscrowCancelled: Detected likely auto-cancellation by arbitrator for escrow ${escrowId}`);
              
              // Update our auto-cancellation record if it exists but wasn't linked to tx hash
              await pool.query(`
                UPDATE contract_auto_cancellations 
                SET transaction_hash = $1, status = 'SUCCESS'
                WHERE escrow_id = $2 AND transaction_hash IS NULL AND status = 'PENDING'
              `, [txHash, escrowId]);
            }
          } catch (error) {
            console.error(`EscrowCancelled: Error checking auto-cancellation status:`, error);
            fileLog(`EscrowCancelled: Error checking auto-cancellation status: ${error}`);
          }

          // Update escrow state to CANCELLED and set balance to 0 (funds returned)
          const cancellationNote = isAutoCancellation ? 'AUTO_CANCELLED' : 'CANCELLED';
          await query(
            'UPDATE escrows SET state = $1, current_balance = $2, updated_at = CURRENT_TIMESTAMP, completed_at = to_timestamp($3) WHERE onchain_escrow_id = $4 AND state <> $1',
            [cancellationNote, 0, timestamp, escrowId]
          );
          console.log(`EscrowCancelled: Updated escrow onchainId=${escrowId} state=${cancellationNote} current_balance=0 at timestamp=${timestamp}`);
          fileLog(`EscrowCancelled: Updated escrow onchainId=${escrowId} state=${cancellationNote} current_balance=0 at timestamp=${timestamp}`);
          
          // Update trade state to CANCELLED
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['CANCELLED', escrowId]
          );
          console.log(`EscrowCancelled: Updated trade leg1_state=CANCELLED for escrowId=${escrowId}`);
          fileLog(`EscrowCancelled: Updated trade leg1_state=CANCELLED for escrowId=${escrowId}`);
          
          // Also update leg2 if it exists
          await query(
            'UPDATE trades SET leg2_state = $1 WHERE leg2_escrow_onchain_id = $2 AND leg2_state <> $1',
            ['CANCELLED', escrowId]
          );
          
          // Get trade ID for this escrow to record completion (cancellation is also a form of completion)
          const tradeResult = await query(
            'SELECT id FROM trades WHERE leg1_escrow_onchain_id = $1 OR leg2_escrow_onchain_id = $1 LIMIT 1',
            [escrowId]
          );
          
          if (tradeResult.length > 0) {
            const tradeId = tradeResult[0].id;
            
            // Check if both legs are cancelled or if this is a single-leg trade
            const tradeStateResult = await query(
              'SELECT leg1_state, leg2_state, leg2_escrow_onchain_id FROM trades WHERE id = $1',
              [tradeId]
            );
            
            if (tradeStateResult.length > 0) {
              const { leg1_state, leg2_state, leg2_escrow_onchain_id } = tradeStateResult[0];
              
              // If this is a single-leg trade or both legs are cancelled, mark the trade as completed
              if (!leg2_escrow_onchain_id || (leg1_state === 'CANCELLED' && leg2_state === 'CANCELLED')) {
                await query(
                  'UPDATE trades SET completed = TRUE, completed_at = to_timestamp($1), cancelled = TRUE WHERE id = $2 AND completed = FALSE',
                  [timestamp, tradeId]
                );
                console.log(`EscrowCancelled: Marked trade ${tradeId} as completed (cancelled) at timestamp=${timestamp}`);
                fileLog(`EscrowCancelled: Marked trade ${tradeId} as completed (cancelled) at timestamp=${timestamp}`);
              }
            }
          }
          
          break;
        }
        case 'DisputeOpened': {
          const escrowId = parsed.args.escrowId.toString();
          // mark escrow disputed
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND state <> $1',
            ['DISPUTED', escrowId]
          );
          console.log(`DisputeOpened: Updated escrow onchainId=${escrowId} state=DISPUTED`);
          fileLog(`DisputeOpened: Updated escrow onchainId=${escrowId} state=DISPUTED`);
          // update trade legs disputed
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['DISPUTED', escrowId]
          );
          console.log(`DisputeOpened: Updated trade leg1_state=DISPUTED for escrowId=${escrowId}`);
          fileLog(`DisputeOpened: Updated trade leg1_state=DISPUTED for escrowId=${escrowId}`);
          await query(
            'UPDATE trades SET leg2_state = $1 WHERE leg2_escrow_onchain_id = $2 AND leg2_state <> $1',
            ['DISPUTED', escrowId]
          );
          console.log(`DisputeOpened: Updated trade leg2_state=DISPUTED for escrowId=${escrowId}`);
          fileLog(`DisputeOpened: Updated trade leg2_state=DISPUTED for escrowId=${escrowId}`);
          break;
        }
        case 'DisputeResponse': {
          const escrowId = parsed.args.escrowId.toString();
          // mark escrow resolved
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND state <> $1',
            ['RESOLVED', escrowId]
          );
          console.log(`DisputeResponse: Updated escrow onchainId=${escrowId} state=RESOLVED`);
          fileLog(`DisputeResponse: Updated escrow onchainId=${escrowId} state=RESOLVED`);
          // update trade legs resolved
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['RESOLVED', escrowId]
          );
          console.log(
            `DisputeResponse: Updated trade leg1_state=RESOLVED for escrowId=${escrowId}`
          );
          fileLog(`DisputeResponse: Updated trade leg1_state=RESOLVED for escrowId=${escrowId}`);
          await query(
            'UPDATE trades SET leg2_state = $1 WHERE leg2_escrow_onchain_id = $2 AND leg2_state <> $1',
            ['RESOLVED', escrowId]
          );
          console.log(
            `DisputeResponse: Updated trade leg2_state=RESOLVED for escrowId=${escrowId}`
          );
          fileLog(`DisputeResponse: Updated trade leg2_state=RESOLVED for escrowId=${escrowId}`);
          break;
        }
        case 'DisputeResolved': {
          const escrowId = parsed.args.escrowId.toString();

          // mark escrow resolved and set balance to 0 (funds distributed)
          await query(
            'UPDATE escrows SET state = $1, current_balance = $2, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $3 AND state <> $1',
            ['RESOLVED', 0, escrowId]
          );
          console.log(`DisputeResolved: Updated escrow onchainId=${escrowId} state=RESOLVED current_balance=0`);
          fileLog(`DisputeResolved: Updated escrow onchainId=${escrowId} state=RESOLVED current_balance=0`);

          // update trade legs resolved
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['RESOLVED', escrowId]
          );
          console.log(
            `DisputeResolved: Updated trade leg1_state=RESOLVED for escrowId=${escrowId}`
          );
          fileLog(`DisputeResolved: Updated trade leg1_state=RESOLVED for escrowId=${escrowId}`);

          await query(
            'UPDATE trades SET leg2_state = $1 WHERE leg2_escrow_onchain_id = $2 AND leg2_state <> $1',
            ['RESOLVED', escrowId]
          );
          console.log(
            `DisputeResolved: Updated trade leg2_state=RESOLVED for escrowId=${escrowId}`
          );
          fileLog(`DisputeResolved: Updated trade leg2_state=RESOLVED for escrowId=${escrowId}`);
          break;
        }
        case 'SequentialAddressUpdated': {
          const escrowId = parsed.args.escrowId.toString();
          const newAddress = parsed.args.newAddress as string;

          await query(
            'UPDATE escrows SET sequential_escrow_address = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2',
            [newAddress, escrowId]
          );
          console.log(
            `SequentialAddressUpdated: Updated escrow onchainId=${escrowId} sequential_escrow_address=${newAddress}`
          );
          fileLog(
            `SequentialAddressUpdated: Updated escrow onchainId=${escrowId} sequential_escrow_address=${newAddress}`
          );
          break;
        }
        case 'EscrowBalanceChanged': {
          const escrowId = parsed.args.escrowId.toString();
          const newBalance = parsed.args.newBalance.toString();
          const reason = parsed.args.reason as string;

          // Convert blockchain amount (with 6 decimals) to database decimal format
          const balanceInDecimal = Number(newBalance) / 1_000_000;

          await query(
            'UPDATE escrows SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2',
            [balanceInDecimal, escrowId]
          );
          console.log(
            `EscrowBalanceChanged: Updated escrow onchainId=${escrowId} current_balance=${balanceInDecimal} reason=${reason}`
          );
          fileLog(
            `EscrowBalanceChanged: Updated escrow onchainId=${escrowId} current_balance=${balanceInDecimal} reason=${reason}`
          );
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error('Error handling log:', err);
      fileLog(`Error handling log: ${err}`);

      // Attempt to record the error
      try {
        // Record a more detailed error transaction
        await recordTransaction({
          transaction_hash: log.transactionHash,
          status: 'FAILED',
          type: 'EVENT',
          block_number: log.blockNumber,
          related_trade_id: null,
          error_message: `Event listener error: ${(err as Error).message || 'Unknown error'}`,
          network_id: defaultNetwork.id,
        });

        console.log(`[RECOVERY] Recorded error transaction for ${log.transactionHash}`);
        fileLog(`[RECOVERY] Recorded error transaction for ${log.transactionHash}`);
      } catch (recordErr) {
        // If even the error recording fails, just log it without further action
        console.error('Failed to record error transaction:', recordErr);
        fileLog(`Failed to record error transaction: ${recordErr}`);
      }
    }
  });
}
