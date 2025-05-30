import express, { Response } from 'express';
import { query } from '../../db';
import { withErrorHandling } from '../../middleware/errorHandler';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { AuthenticatedRequest } from '../../middleware/auth';
import { validateReferralSubmission, validateReferralQuery } from './validation';
import { validatePagination, calculatePagination, sendPaginatedResponse, sendSuccess, sendError } from '../../utils/routeHelpers';

const router = express.Router();

// POST /divvi-referrals - Submit a referral to Divvi and store the result
router.post(
  '/',
  validateReferralSubmission,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { transactionHash, chainId, tradeId } = req.body;
    const walletAddress = getWalletAddressFromJWT(req);

    try {
      // Check if referral already exists for this transaction
      const existingReferral = await query(
        'SELECT id FROM divvi_referrals WHERE transaction_hash = $1 AND chain_id = $2',
        [transactionHash, chainId]
      );

      if (existingReferral.length > 0) {
        res.status(409).json({ 
          error: 'Referral already exists for this transaction',
          referralId: existingReferral[0].id
        });
        return;
      }

      // Validate trade_id if provided
      if (tradeId) {
        const tradeExists = await query('SELECT id FROM trades WHERE id = $1', [tradeId]);
        if (tradeExists.length === 0) {
          sendError(res, 'Trade not found', 400);
          return;
        }
      }

      let submissionStatus: number | null = null;
      let submissionResponse: Record<string, unknown> | null = null;
      let submittedProvidersWithExistingReferral: Record<string, unknown> | null = null;
      let errorMessage: string | null = null;
      let submittedAt: Date | null = null;

      try {
        // Import submitReferral dynamically to avoid build issues if package isn't available
        let submitReferral;
        try {
          const divviModule = require('@divvi/referral-sdk');
          submitReferral = divviModule.submitReferral;
        } catch {
          throw new Error('Divvi SDK not available');
        }
        
        submittedAt = new Date();
        const divviResponse = await submitReferral({ 
          txHash: transactionHash, 
          chainId: chainId 
        });

        // Divvi SDK doesn't return HTTP status codes directly, so we assume 200 if no error
        submissionStatus = 200;
        submissionResponse = divviResponse;
        
        // Extract the specific field we're interested in
        if (divviResponse && divviResponse.data && divviResponse.data.submittedProvidersWithExistingReferral) {
          submittedProvidersWithExistingReferral = divviResponse.data.submittedProvidersWithExistingReferral;
        }

      } catch (divviError: unknown) {
        console.error('Divvi submission error:', divviError);
        
        // Try to extract status code from error
        const error = divviError as Record<string, unknown>;
        if (error.response && typeof error.response === 'object') {
          const response = error.response as Record<string, unknown>;
          submissionStatus = typeof response.status === 'number' ? response.status : 500;
          submissionResponse = response.data as Record<string, unknown>;
        } else if (typeof error.status === 'number') {
          submissionStatus = error.status;
          submissionResponse = error;
        } else {
          submissionStatus = 500; // Default to server error
          submissionResponse = { error: typeof error.message === 'string' ? error.message : 'Unknown error' };
        }
        
        errorMessage = typeof error.message === 'string' ? error.message : 'Divvi submission failed';
      }

      // Store the referral attempt regardless of success/failure
      const result = await query(
        `INSERT INTO divvi_referrals 
         (wallet_address, transaction_hash, chain_id, trade_id, submission_status, 
          submission_response, submitted_providers_with_existing_referral, 
          error_message, submitted_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING *`,
        [
          walletAddress,
          transactionHash,
          chainId,
          tradeId || null,
          submissionStatus,
          submissionResponse ? JSON.stringify(submissionResponse) : null,
          submittedProvidersWithExistingReferral ? JSON.stringify(submittedProvidersWithExistingReferral) : null,
          errorMessage,
          submittedAt
        ]
      );

      const referral = result[0];

      // Return appropriate response based on submission status
      if (submissionStatus === 200) {
        res.status(201).json({
          success: true,
          message: 'Referral submitted successfully',
          referral: referral,
          hasExistingReferrals: submittedProvidersWithExistingReferral && Array.isArray(submittedProvidersWithExistingReferral) && submittedProvidersWithExistingReferral.length > 0
        });
      } else {
        res.status(submissionStatus || 500).json({
          success: false,
          message: 'Referral submission failed',
          referral: referral,
          error: errorMessage
        });
      }

    } catch (error) {
      console.error('Error in divvi-referrals endpoint:', error);
      sendError(res, 'Internal server error', 500, (error as Error).message);
    }
  })
);

// GET /divvi-referrals - Get user's referrals
router.get(
  '/',
  validateReferralQuery,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const walletAddress = getWalletAddressFromJWT(req);
    const { page, limit, offset } = validatePagination(req);

    try {
      // Get referrals with optional trade information
      const referrals = await query(
        `SELECT dr.*, t.id as trade_exists 
         FROM divvi_referrals dr 
         LEFT JOIN trades t ON dr.trade_id = t.id 
         WHERE dr.wallet_address = $1 
         ORDER BY dr.created_at DESC 
         LIMIT $2 OFFSET $3`,
        [walletAddress, limit, offset]
      );

      // Get total count for pagination
      const countResult = await query(
        'SELECT COUNT(*) FROM divvi_referrals WHERE wallet_address = $1',
        [walletAddress]
      );

      const totalCount = parseInt(countResult[0].count);
      const pagination = calculatePagination(page, limit, totalCount);

      sendPaginatedResponse(res, referrals, pagination);

    } catch (error) {
      console.error('Error fetching divvi referrals:', error);
      sendError(res, 'Internal server error', 500, (error as Error).message);
    }
  })
);

// GET /divvi-referrals/:id - Get specific referral
router.get(
  '/:id',
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const walletAddress = getWalletAddressFromJWT(req);
    
    if (!walletAddress) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    try {
      const result = await query(
        `SELECT dr.*, t.id as trade_exists 
         FROM divvi_referrals dr 
         LEFT JOIN trades t ON dr.trade_id = t.id 
         WHERE dr.id = $1 AND dr.wallet_address = $2`,
        [id, walletAddress]
      );

      if (result.length === 0) {
        sendError(res, 'Referral not found', 404);
        return;
      }

      sendSuccess(res, result[0]);

    } catch (error) {
      console.error('Error fetching divvi referral:', error);
      sendError(res, 'Internal server error', 500, (error as Error).message);
    }
  })
);

export default router;