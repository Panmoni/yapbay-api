import express, { type Response } from 'express';
import { query, recordTransaction, withTransaction } from '../../db';
import { logError } from '../../logger';
// import { ethers } from 'ethers'; // CELO - DISABLED
// import YapBayEscrowABI from '../../contract/YapBayEscrow.json'; // CELO - DISABLED
import type { AuthenticatedRequest } from '../../middleware/auth';
import { withErrorHandling } from '../../middleware/errorHandler';
import { requireNetwork } from '../../middleware/networkMiddleware';
import { BlockchainServiceFactory } from '../../services/blockchainService';
// import { CeloService } from '../../celo'; // CELO - DISABLED
import { NetworkService } from '../../services/networkService';
import { NetworkFamily } from '../../types/networks';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { requireEscrowList } from './middleware';
import { validateEscrowRecord } from './validation';

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

    const networkId = req.networkId!;

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      res.status(400).json({ error: 'Invalid network' });
      return;
    }

    const blockchainService = BlockchainServiceFactory.create(network);

    // Determine transaction identifier based on network family
    const transactionIdentifier =
      network.networkFamily === NetworkFamily.EVM ? transaction_hash : signature;

    // Validate transaction identifier
    if (!blockchainService.validateTransactionHash(transactionIdentifier)) {
      res.status(400).json({ error: 'Invalid transaction identifier for network' });
      return;
    }

    try {
      // Verify the trade exists and get deadline information
      const tradeCheck = await query('SELECT * FROM trades WHERE id = $1 AND network_id = $2', [
        trade_id,
        networkId,
      ]);
      if (tradeCheck.length === 0) {
        res.status(404).json({ error: 'Trade not found' });
        return;
      }

      const trade = tradeCheck[0];
      const depositDeadline = trade.leg1_escrow_deposit_deadline;
      const fiatDeadline = trade.leg1_fiat_payment_deadline;

      // Validate amount
      const parsedAmount = Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        res.status(400).json({ error: 'Invalid escrow amount' });
        return;
      }

      // Record escrow with network-specific fields
      const escrowData = {
        trade_id,
        escrow_address:
          network.networkFamily === NetworkFamily.EVM ? network.contractAddress : escrow_pda,
        onchain_escrow_id: escrow_id,
        seller_address: seller,
        buyer_address: buyer,
        arbitrator_address: network.arbitratorAddress,
        token_type: 'USDC',
        amount: parsedAmount,
        state: 'CREATED',
        sequential,
        sequential_escrow_address,
        network_id: networkId,
        network_family: network.networkFamily,
        program_id: network.networkFamily === NetworkFamily.SOLANA ? program_id : null,
        escrow_pda: network.networkFamily === NetworkFamily.SOLANA ? escrow_pda : null,
        escrow_token_account:
          network.networkFamily === NetworkFamily.SOLANA ? escrow_token_account : null,
        escrow_onchain_id: network.networkFamily === NetworkFamily.SOLANA ? escrow_id : null,
        trade_onchain_id: network.networkFamily === NetworkFamily.SOLANA ? trade_onchain_id : null,
      };

      // Wrap escrow insert + transaction record in a single DB transaction
      const { escrowDbId } = await withTransaction(async (client) => {
        // Check if an escrow with this onchain_escrow_id already exists
        const { rows: existingEscrow } = await client.query(
          'SELECT id FROM escrows WHERE onchain_escrow_id = $1 AND network_id = $2',
          [escrow_id, networkId],
        );

        let dbId;

        if (existingEscrow.length > 0) {
          dbId = existingEscrow[0].id;
          await client.query(
            'UPDATE escrows SET state = $1, deposit_deadline = $2, fiat_deadline = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
            ['CREATED', depositDeadline, fiatDeadline, dbId],
          );
        } else {
          const { rows: result } = await client.query(
            `INSERT INTO escrows (
              trade_id, escrow_address, onchain_escrow_id, seller_address, buyer_address,
              arbitrator_address, token_type, amount, state, sequential, sequential_escrow_address,
              network_id, network_family, program_id, escrow_pda, escrow_token_account,
              escrow_onchain_id, trade_onchain_id, deposit_deadline, fiat_deadline
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING id`,
            [
              escrowData.trade_id,
              escrowData.escrow_address,
              escrowData.onchain_escrow_id,
              escrowData.seller_address,
              escrowData.buyer_address,
              escrowData.arbitrator_address,
              escrowData.token_type,
              escrowData.amount,
              escrowData.state,
              escrowData.sequential,
              escrowData.sequential_escrow_address,
              escrowData.network_id,
              escrowData.network_family,
              escrowData.program_id,
              escrowData.escrow_pda,
              escrowData.escrow_token_account,
              escrowData.escrow_onchain_id,
              escrowData.trade_onchain_id,
              depositDeadline,
              fiatDeadline,
            ],
          );

          if (result.length === 0 || !result[0].id) {
            throw new Error('Escrow insertion failed');
          }
          dbId = result[0].id;
        }

        return { escrowDbId: dbId };
      });

      // Record transaction (outside main transaction — ON CONFLICT handles dedup)
      await recordTransaction({
        transaction_hash: network.networkFamily === NetworkFamily.EVM ? transaction_hash : null,
        signature: network.networkFamily === NetworkFamily.SOLANA ? signature : null,
        type: 'CREATE_ESCROW',
        sender_address: seller,
        receiver_or_contract_address:
          network.networkFamily === NetworkFamily.EVM ? network.contractAddress : escrow_pda,
        status: 'SUCCESS',
        related_trade_id: trade_id,
        related_escrow_db_id: escrowDbId,
        network_id: networkId,
        block_number: network.networkFamily === NetworkFamily.EVM ? undefined : null,
      });

      res.json({
        success: true,
        escrowId: escrow_id,
        escrowDbId,
        txHash: network.networkFamily === NetworkFamily.EVM ? transaction_hash : signature,
        networkFamily: network.networkFamily,
        blockExplorerUrl: blockchainService.getBlockExplorerUrl(transactionIdentifier),
      });
    } catch (error) {
      // Record failed transaction
      try {
        await recordTransaction({
          transaction_hash: network.networkFamily === NetworkFamily.EVM ? transaction_hash : null,
          signature: network.networkFamily === NetworkFamily.SOLANA ? signature : null,
          type: 'CREATE_ESCROW',
          sender_address: seller,
          receiver_or_contract_address:
            network.networkFamily === NetworkFamily.EVM ? network.contractAddress : escrow_pda,
          status: 'FAILED',
          related_trade_id: trade_id,
          error_message: (error as Error).message,
          network_id: networkId,
        });
      } catch (recordErr) {
        logError('Failed to record failed transaction', recordErr as Error);
      }

      logError('Error occurred while recording escrow', error as Error);
      res.status(500).json({
        error: 'Internal server error',
        details: 'Error occurred while recording escrow',
      });
    }
  }),
);

// List escrows for authenticated user
router.get(
  '/my',
  requireNetwork,
  requireEscrowList,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    const networkId = req.networkId!;
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 100);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const result = await query(
      `SELECT e.*, n.name as network FROM escrows e
       LEFT JOIN networks n ON e.network_id = n.id
       WHERE e.network_id = $1
       AND (LOWER(e.seller_address) = LOWER($2) OR LOWER(e.buyer_address) = LOWER($2))
       ORDER BY e.created_at DESC
       LIMIT $3 OFFSET $4`,
      [networkId, jwtWalletAddress, limit, offset],
    );
    res.json(result);
  }),
);

export default router;
