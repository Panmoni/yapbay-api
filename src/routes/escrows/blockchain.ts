import { ethers } from 'ethers';
import express, { type Response } from 'express';
import { CeloService } from '../../celo';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { withErrorHandling } from '../../middleware/errorHandler';
import { requireNetwork } from '../../middleware/networkMiddleware';
import { validate } from '../../middleware/validate';
import { validateResponse } from '../../middleware/validateResponse';
import {
  escrowAutoCancelResponseSchema,
  escrowBalanceResponseSchema,
  escrowCalculatedBalanceResponseSchema,
  escrowSequentialInfoResponseSchema,
  escrowStoredBalanceResponseSchema,
  onchainEscrowIdParamsSchema,
} from '../../schemas/escrows';
import { requireEscrowParticipant } from './middleware';

const router = express.Router();

// Get escrow balance by onchain escrow ID
router.get(
  '/:onchainEscrowId/balance',
  requireNetwork,
  validate({ params: onchainEscrowIdParamsSchema }),
  requireEscrowParticipant,
  validateResponse(escrowBalanceResponseSchema),
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { onchainEscrowId } = req.params;
    const networkId = req.networkId!;

    try {
      const balance = await CeloService.getEscrowBalance(
        networkId,
        Number.parseInt(onchainEscrowId, 10),
      );
      res.json({
        network: req.network!.name,
        escrowId: onchainEscrowId,
        balance,
      });
    } catch (error) {
      console.error('Error fetching escrow balance:', error);
      res.status(500).json({ error: 'Failed to fetch escrow balance' });
    }
  }),
);

// Get stored escrow balance from contract
router.get(
  '/:onchainEscrowId/stored-balance',
  requireNetwork,
  validate({ params: onchainEscrowIdParamsSchema }),
  requireEscrowParticipant,
  validateResponse(escrowStoredBalanceResponseSchema),
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { onchainEscrowId } = req.params;
    const networkId = req.networkId!;

    try {
      const contract = await CeloService.getContractForNetwork(networkId);
      const stored = await contract.getStoredEscrowBalance(onchainEscrowId);

      res.json({
        escrowId: onchainEscrowId,
        storedBalance: ethers.formatUnits(stored, 6),
      });
    } catch (error) {
      console.error('Error fetching stored escrow balance:', error);
      res.status(500).json({ error: 'Failed to fetch stored escrow balance' });
    }
  }),
);

// Get calculated escrow balance from contract
router.get(
  '/:onchainEscrowId/calculated-balance',
  requireNetwork,
  validate({ params: onchainEscrowIdParamsSchema }),
  requireEscrowParticipant,
  validateResponse(escrowCalculatedBalanceResponseSchema),
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { onchainEscrowId } = req.params;
    const networkId = req.networkId!;

    try {
      const contract = await CeloService.getContractForNetwork(networkId);
      const calculated = await contract.getCalculatedEscrowBalance(onchainEscrowId);

      res.json({
        escrowId: onchainEscrowId,
        calculatedBalance: ethers.formatUnits(calculated, 6),
      });
    } catch (error) {
      console.error('Error fetching calculated escrow balance:', error);
      res.status(500).json({ error: 'Failed to fetch calculated escrow balance' });
    }
  }),
);

// Get sequential escrow information
router.get(
  '/:onchainEscrowId/sequential-info',
  requireNetwork,
  validate({ params: onchainEscrowIdParamsSchema }),
  requireEscrowParticipant,
  validateResponse(escrowSequentialInfoResponseSchema),
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { onchainEscrowId } = req.params;
    const networkId = req.networkId!;

    try {
      const sequentialInfo = await CeloService.getSequentialInfo(
        networkId,
        Number.parseInt(onchainEscrowId, 10),
      );

      res.json({
        network: req.network!.name,
        escrowId: onchainEscrowId,
        sequentialInfo,
      });
    } catch (error) {
      console.error('Error fetching sequential escrow info:', error);
      res.status(500).json({ error: 'Failed to fetch sequential escrow info' });
    }
  }),
);

// Check if escrow is eligible for auto-cancellation
router.get(
  '/:onchainEscrowId/auto-cancel-eligible',
  requireNetwork,
  validate({ params: onchainEscrowIdParamsSchema }),
  requireEscrowParticipant,
  validateResponse(escrowAutoCancelResponseSchema),
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { onchainEscrowId } = req.params;
    const networkId = req.networkId!;

    try {
      const isEligible = await CeloService.checkAutoCancelEligible(
        networkId,
        Number.parseInt(onchainEscrowId, 10),
      );

      res.json({
        escrowId: onchainEscrowId,
        isEligibleForAutoCancel: isEligible,
      });
    } catch (error) {
      console.error('Error checking auto-cancel eligibility:', error);
      res.status(500).json({ error: 'Failed to check auto-cancel eligibility' });
    }
  }),
);

export default router;
