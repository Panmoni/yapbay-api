import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';

export const validateReferralSubmission = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const { transactionHash, chainId } = req.body;
  const walletAddress = getWalletAddressFromJWT(req);

  if (!walletAddress) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!transactionHash || !chainId) {
    res.status(400).json({ error: 'transactionHash and chainId are required' });
    return;
  }

  // Validate transaction hash format
  if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
    res.status(400).json({ error: 'Invalid transaction hash format' });
    return;
  }

  // Validate chainId is a number
  if (typeof chainId !== 'number' || chainId <= 0) {
    res.status(400).json({ error: 'chainId must be a positive number' });
    return;
  }

  next();
};

export const validateReferralQuery = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const walletAddress = getWalletAddressFromJWT(req);
  
  if (!walletAddress) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Validate pagination parameters
  const page = req.query.page ? parseInt(req.query.page as string) : 1;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

  if (page < 1) {
    res.status(400).json({ error: 'page must be a positive integer' });
    return;
  }

  if (limit < 1 || limit > 100) {
    res.status(400).json({ error: 'limit must be between 1 and 100' });
    return;
  }

  next();
};