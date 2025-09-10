import express, { Response } from 'express';
import { query, recordTransaction } from '../../db';
import { CeloService } from '../../celo';
import { NetworkService } from '../../services/networkService';
import { BlockchainServiceFactory } from '../../services/blockchainService';
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
      transaction_hash, // EVM
      signature, // Solana
      escrow_id,
      seller,
      buyer,
      amount,
      sequential,
      sequential_escrow_address,
      // Solana-specific fields
      program_id,
      escrow_pda,
      escrow_token_account,
      trade_onchain_id,
    } = req.body;
    
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    const networkId = req.networkId!;

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      res.status(400).json({ error: 'Invalid network' });
      return;
    }

    const blockchainService = BlockchainServiceFactory.create(network);

    // Determine transaction identifier based on network family
    const transactionIdentifier = network.networkFamily === 'evm' ? transaction_hash : signature;
    
    // Validate transaction identifier
    if (!blockchainService.validateTransactionHash(transactionIdentifier)) {
      res.status(400).json({ error: 'Invalid transaction identifier for network' });
      return;
    }

    try {
      // Verify the trade exists
      const tradeCheck = await query('SELECT * FROM trades WHERE id = $1 AND network_id = $2', [
        trade_id,
        networkId,
      ]);
      if (tradeCheck.length === 0) {
        res.status(404).json({ error: 'Trade not found' });
        return;
      }

      // For now, skip blockchain verification for Solana networks
      // This will be handled by the event monitoring microservice
      if (network.networkFamily === 'solana') {
        // Skip blockchain verification for Solana - will be handled by event listener
        console.log(`[DEBUG] Skipping blockchain verification for Solana network: ${network.name}`);
      } else if (network.networkFamily === 'evm') {
        // Verify the transaction on the blockchain for EVM networks
        try {
          const provider = await CeloService.getProviderForNetwork(networkId);
          const txReceipt = await provider.getTransactionReceipt(transaction_hash);

          if (!txReceipt || txReceipt.status !== 1) {
            res.status(400).json({
              error: 'Transaction not found or failed on the blockchain',
              details: txReceipt ? `Status: ${txReceipt.status}` : 'Receipt not found',
            });
            return;
          }

          // Verify this is a transaction to our contract
          if (txReceipt.to?.toLowerCase() !== network.contractAddress?.toLowerCase()) {
            res.status(400).json({
              error: 'Transaction is not for the YapBay escrow contract',
              details: `Transaction to: ${txReceipt.to}, expected: ${network.contractAddress}`,
            });
            return;
          }

          // Parse logs to verify EscrowCreated event for EVM networks
          let escrowCreatedEvent = false;
          let verifiedEscrowId: string | null = null;
          let contractVersion: string | null = null;

          if (txReceipt.logs) {
            const escrowCreatedInterface = new ethers.Interface(YapBayEscrowABI.abi);
            for (const log of txReceipt.logs) {
              if (log.address.toLowerCase() === network.contractAddress?.toLowerCase()) {
                try {
                  const parsedLog = escrowCreatedInterface.parseLog({
                    topics: log.topics as string[],
                    data: log.data,
                  });

                  if (parsedLog && parsedLog.name === 'EscrowCreated') {
                    escrowCreatedEvent = true;
                    const txEscrowIdBigInt = parsedLog.args.escrowId;
                    verifiedEscrowId = txEscrowIdBigInt.toString();
                    contractVersion = parsedLog.args.version;

                    // Verify escrow ID matches
                    const providedEscrowIdNum = BigInt(escrow_id);
                    if (txEscrowIdBigInt !== providedEscrowIdNum) {
                      res.status(400).json({
                        error: 'Escrow ID in transaction does not match provided escrow_id',
                        details: `Transaction escrow ID: ${verifiedEscrowId}, provided: ${escrow_id}`,
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
        }

      // Record escrow with network-specific fields
      const escrowData = {
        trade_id,
        escrow_address: network.networkFamily === 'evm' ? network.contractAddress : escrow_pda,
        onchain_escrow_id: escrow_id,
        seller_address: seller,
        buyer_address: buyer,
        arbitrator_address: network.arbitratorAddress,
        token_type: 'USDC',
        amount: network.networkFamily === 'evm' ? Number(amount) / 1_000_000 : Number(amount) / 1_000_000,
        state: 'CREATED',
        sequential,
        sequential_escrow_address,
        network_id: networkId,
        network_family: network.networkFamily,
        // Solana-specific fields
        program_id: network.networkFamily === 'solana' ? program_id : null,
        escrow_pda: network.networkFamily === 'solana' ? escrow_pda : null,
        escrow_token_account: network.networkFamily === 'solana' ? escrow_token_account : null,
        escrow_onchain_id: network.networkFamily === 'solana' ? escrow_id : null,
        trade_onchain_id: network.networkFamily === 'solana' ? trade_onchain_id : null,
      };

      // Check if an escrow with this onchain_escrow_id already exists
      const existingEscrow = await query('SELECT id FROM escrows WHERE onchain_escrow_id = $1 AND network_id = $2', [
        escrow_id,
        networkId,
      ]);

      let escrowDbId;

      if (existingEscrow.length > 0) {
        // Escrow already exists - update it
        escrowDbId = existingEscrow[0].id;
        await query(
          'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          ['CREATED', escrowDbId]
        );
        console.log(`Updated existing escrow id=${escrowDbId} with onchain_escrow_id=${escrow_id}`);
      } else {
        // Insert new escrow record
        const result = await query(
          `INSERT INTO escrows (
            trade_id, escrow_address, onchain_escrow_id, seller_address, buyer_address,
            arbitrator_address, token_type, amount, state, sequential, sequential_escrow_address,
            network_id, network_family, program_id, escrow_pda, escrow_token_account,
            escrow_onchain_id, trade_onchain_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          RETURNING id`,
          [
            escrowData.trade_id, escrowData.escrow_address, escrowData.onchain_escrow_id,
            escrowData.seller_address, escrowData.buyer_address, escrowData.arbitrator_address,
            escrowData.token_type, escrowData.amount, escrowData.state, escrowData.sequential,
            escrowData.sequential_escrow_address, escrowData.network_id, escrowData.network_family,
            escrowData.program_id, escrowData.escrow_pda, escrowData.escrow_token_account,
            escrowData.escrow_onchain_id, escrowData.trade_onchain_id
          ]
        );

        if (result.length === 0 || !result[0].id) {
          logError(`Failed to insert escrow record for trade ${trade_id}`, new Error('Escrow insertion failed'));
          res.status(500).json({ error: 'Failed to record escrow in database' });
          return;
        }

        escrowDbId = result[0].id;
      }

      // Record transaction with network-specific fields
      await recordTransaction({
        transaction_hash: network.networkFamily === 'evm' ? transaction_hash : null,
        signature: network.networkFamily === 'solana' ? signature : null,
        type: 'CREATE_ESCROW',
        from_address: seller,
        to_address: network.networkFamily === 'evm' ? network.contractAddress : escrow_pda,
        status: 'SUCCESS',
        related_trade_id: trade_id,
        related_escrow_db_id: escrowDbId,
        network_id: networkId,
        network_family: network.networkFamily,
        block_number: network.networkFamily === 'evm' ? undefined : null, // Will be filled by event listener
        slot: network.networkFamily === 'solana' ? undefined : null, // Will be filled by event listener
      });

      res.json({
        success: true,
        escrowId: escrow_id,
        escrowDbId: escrowDbId,
        txHash: network.networkFamily === 'evm' ? transaction_hash : signature,
        networkFamily: network.networkFamily,
        blockExplorerUrl: blockchainService.getBlockExplorerUrl(transactionIdentifier),
      });
    } catch (error) {
      // Record failed transaction
      await recordTransaction({
        transaction_hash: network.networkFamily === 'evm' ? transaction_hash : null,
        signature: network.networkFamily === 'solana' ? signature : null,
        type: 'CREATE_ESCROW',
        from_address: seller,
        to_address: network.networkFamily === 'evm' ? network.contractAddress : escrow_pda,
        status: 'FAILED',
        related_trade_id: trade_id,
        error_message: (error as Error).message,
        network_id: networkId,
        network_family: network.networkFamily,
      });

      logError('Error occurred while recording escrow', error as Error);
      res.status(500).json({
        error: 'Internal server error',
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
