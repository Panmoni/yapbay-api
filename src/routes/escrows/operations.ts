import express, { Response } from 'express';
import { query, recordTransaction } from '../../db';
import { CeloService } from '../../celo';
import { NetworkService } from '../../services/networkService';
import { requireNetwork } from '../../middleware/networkMiddleware';
import { withErrorHandling } from '../../middleware/errorHandler';
import { logError } from '../../logger';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { ethers } from 'ethers';
import YapBayEscrowABI from '../../contract/YapBayEscrow.json';
import { AuthenticatedRequest } from '../../middleware/auth';
import { validateEscrowRecord } from './validation';
import { requireEscrowList } from './middleware';

const router = express.Router();

// Record escrow creation
router.post(
  '/record',
  requireNetwork,
  validateEscrowRecord,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const {
      trade_id,
      transaction_hash,
      escrow_id,
      seller,
      buyer,
      amount,
      sequential,
      sequential_escrow_address,
    } = req.body;
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    const networkId = req.networkId!;

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      res.status(400).json({ error: 'Invalid network' });
      return;
    }
    const CONTRACT_ADDRESS = network.contractAddress;
    if (!CONTRACT_ADDRESS) {
      logError(
        'CONTRACT_ADDRESS environment variable not set',
        new Error('CONTRACT_ADDRESS not set')
      );
      res.status(500).json({ error: 'Server configuration error: Contract address not set' });
      return;
    }

    try {
      // Verify the trade exists
      const tradeCheck = await query('SELECT * FROM trades WHERE id = $1 AND network_id = $2', [trade_id, networkId]);
      if (tradeCheck.length === 0) {
        res.status(404).json({ error: 'Trade not found' });
        return;
      }

      // Verify the transaction on the blockchain
      try {
        const defaultNetwork = await NetworkService.getDefaultNetwork();
        const provider = await CeloService.getProviderForNetwork(defaultNetwork.id);
        const txReceipt = await provider.getTransactionReceipt(transaction_hash);

        if (!txReceipt || txReceipt.status !== 1) {
          res.status(400).json({
            error: 'Transaction not found or failed on the blockchain',
            details: txReceipt ? `Status: ${txReceipt.status}` : 'Receipt not found',
          });
          return;
        }

        // Verify this is a transaction to our contract
        if (txReceipt.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
          res.status(400).json({
            error: 'Transaction is not for the YapBay escrow contract',
            details: `Transaction to: ${txReceipt.to}, expected: ${CONTRACT_ADDRESS}`,
          });
          return;
        }

        // Parse logs to verify EscrowCreated event
        let escrowCreatedEvent = false;
        let verifiedEscrowId: string | null = null;

        if (txReceipt.logs) {
          const escrowCreatedInterface = new ethers.Interface(YapBayEscrowABI.abi);
          for (const log of txReceipt.logs) {
            if (log.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()) {
              try {
                const parsedLog = escrowCreatedInterface.parseLog({
                  topics: log.topics as string[],
                  data: log.data,
                });

                if (parsedLog && parsedLog.name === 'EscrowCreated') {
                  escrowCreatedEvent = true;

                  // Get the numeric value of the escrow ID from the transaction
                  const txEscrowIdBigInt = parsedLog.args.escrowId;
                  verifiedEscrowId = txEscrowIdBigInt.toString();

                  // Convert the provided escrow_id to a number for comparison
                  const providedEscrowIdNum = BigInt(escrow_id);

                  console.log(`[DEBUG /escrows/record] Comparing Escrow IDs:`);
                  console.log(`  - Transaction Escrow ID (BigInt): ${txEscrowIdBigInt}`);
                  console.log(`  - Provided Escrow ID (BigInt): ${providedEscrowIdNum}`);

                  // Compare the numeric values directly
                  if (txEscrowIdBigInt !== providedEscrowIdNum) {
                    res.status(400).json({
                      error: 'Escrow ID in transaction does not match provided escrow_id',
                      details: `Transaction escrow ID: ${verifiedEscrowId} (integer), provided: ${escrow_id} (integer)`,
                    });
                    return;
                  }

                  // Verify the trade ID matches
                  if (parsedLog.args.tradeId.toString() !== trade_id.toString()) {
                    res.status(400).json({
                      error: 'Trade ID in transaction does not match provided trade_id',
                      details: `Transaction trade ID: ${parsedLog.args.tradeId}, provided: ${trade_id}`,
                    });
                    return;
                  }

                  break;
                }
              } catch (e) {
                logError('Error parsing transaction log', e);
                // Continue despite parsing errors for non-matching logs
              }
            }
          }
        }

        if (!escrowCreatedEvent || !verifiedEscrowId) {
          res.status(400).json({
            error: 'Transaction does not contain a valid EscrowCreated event',
            details: 'Could not find or parse the EscrowCreated event in transaction logs',
          });
          return;
        }

        // Update the trade with escrow information, including the on-chain escrow ID
        await query(
          'UPDATE trades SET leg1_escrow_address = $1, leg1_state = $2, leg1_escrow_onchain_id = $3 WHERE id = $4',
          [CONTRACT_ADDRESS, 'FUNDED', verifiedEscrowId, trade_id]
        );

        // Check if an escrow with this onchain_escrow_id already exists
        const existingEscrow = await query(
          'SELECT id FROM escrows WHERE onchain_escrow_id = $1',
          [verifiedEscrowId]
        );

        let escrowDbId;

        if (existingEscrow.length > 0) {
          // Escrow already exists - update it instead of creating a duplicate
          escrowDbId = existingEscrow[0].id;
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['FUNDED', escrowDbId]
          );
          console.log(`Updated existing escrow id=${escrowDbId} with onchain_escrow_id=${verifiedEscrowId} to state=FUNDED`);
        } else {
          // Record the escrow in the database and get its ID
          const escrowInsertResult = await query(
            'INSERT INTO escrows (trade_id, escrow_address, seller_address, buyer_address, arbitrator_address, token_type, amount, state, sequential, sequential_escrow_address, onchain_escrow_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
            [
              trade_id,
              CONTRACT_ADDRESS, // Using the main contract address as the escrow identifier for now
              seller,
              buyer,
              process.env.ARBITRATOR_ADDRESS, // Assuming a fixed arbitrator for now
              'USDC', // Assuming USDC
              Number(amount) / 1_000_000, // Convert blockchain amount (with 6 decimals) to database decimal format
              'FUNDED', // State after successful recording
              sequential || false,
              sequential_escrow_address || null,
              verifiedEscrowId, // Store the blockchain escrow ID in the new column
            ]
          );

          if (escrowInsertResult.length === 0 || !escrowInsertResult[0].id) {
            logError(
              `Failed to insert escrow record for trade ${trade_id} and tx ${transaction_hash}`,
              new Error('Escrow insertion failed to return ID')
            );
            // Don't record transaction if escrow insert failed
            res.status(500).json({ error: 'Failed to record escrow in database' });
            return; // Stop execution
          }

          escrowDbId = escrowInsertResult[0].id;
        }

        // Create a mapping record to help with ID synchronization if it doesn't exist
        await query(
          'INSERT INTO escrow_id_mapping (blockchain_id, database_id) VALUES ($1, $2) ON CONFLICT (blockchain_id) DO UPDATE SET database_id = $2',
          [verifiedEscrowId, escrowDbId]
        );
        // Record the successful blockchain transaction
        await recordTransaction({
          transaction_hash: txReceipt.hash,
          status: 'SUCCESS',
          type: 'CREATE_ESCROW', // This endpoint confirms creation
          block_number: txReceipt.blockNumber,
          sender_address: txReceipt.from, // The address that sent the tx (seller)
          receiver_or_contract_address: txReceipt.to, // The contract address
          gas_used: txReceipt.gasUsed,
          related_trade_id: trade_id,
          related_escrow_db_id: escrowDbId, // Link to the DB escrow record
          error_message: null,
          network_id: networkId,
        });

        res.json({
          success: true,
          escrowId: verifiedEscrowId, // The blockchain escrow ID (uint256 as string)
          escrowDbId: escrowDbId, // The database primary key for the escrow record
          txHash: transaction_hash,
          blockNumber: txReceipt.blockNumber,
        });
      } catch (txError) {
        // Attempt to record the FAILED transaction if verification/parsing failed
        await recordTransaction({
          transaction_hash: transaction_hash, // Use the hash we have
          status: 'FAILED',
          type: 'CREATE_ESCROW',
          sender_address: jwtWalletAddress, // Best guess for sender
          receiver_or_contract_address: CONTRACT_ADDRESS,
          related_trade_id: trade_id,
          error_message: (txError as Error).message,
          network_id: networkId,
          // Other fields might be null or unknown here
        });
        logError(`Transaction verification error for hash ${transaction_hash}`, txError as Error);
        res.status(500).json({
          error: (txError as Error).message,
          details: 'Error occurred during transaction verification',
        });
      }
    } catch (err) {
      logError(`Error in /escrows/record endpoint for trade ${trade_id}`, err as Error);
      res.status(500).json({
        error: (err as Error).message,
        details: 'Error occurred while recording escrow',
      });
    }
  })
);

// List escrows for authenticated user
router.get(
  '/my',
  requireNetwork,
  requireEscrowList,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    const networkId = req.networkId!;
    
    const result = await query(
      `SELECT e.* FROM escrows e
       WHERE e.network_id = $1 
       AND (LOWER(e.seller_address) = LOWER($2) OR LOWER(e.buyer_address) = LOWER($2))
       ORDER BY e.created_at DESC`,
      [networkId, jwtWalletAddress]
    );
    res.json(result);
  })
);

export default router;