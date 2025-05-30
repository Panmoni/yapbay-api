import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { ethers } from 'ethers';

export const validateEscrowRecord = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
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

  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }

  if (!seller || jwtWalletAddress.toLowerCase() !== seller.toLowerCase()) {
    res.status(403).json({ error: 'Seller must match authenticated user and be provided' });
    return;
  }

  if (!transaction_hash || !ethers.isHexString(transaction_hash)) {
    res.status(400).json({ error: 'Valid transaction_hash must be provided' });
    return;
  }

  if (!Number.isInteger(Number(trade_id))) {
    res.status(400).json({ error: 'trade_id must be an integer' });
    return;
  }

  // Validate escrow_id is a valid integer
  if (!escrow_id || isNaN(Number(escrow_id)) || Number(escrow_id) <= 0) {
    res.status(400).json({ error: 'Valid escrow_id must be provided as a positive integer' });
    return;
  }

  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  if (!ethers.isAddress(buyer)) {
    res.status(400).json({ error: 'buyer must be a valid Ethereum address' });
    return;
  }

  if (sequential === true && !sequential_escrow_address) {
    res
      .status(400)
      .json({ error: 'sequential_escrow_address must be provided when sequential is true' });
    return;
  }

  if (sequential_escrow_address && !ethers.isAddress(sequential_escrow_address)) {
    res
      .status(400)
      .json({ error: 'sequential_escrow_address must be a valid Ethereum address' });
    return;
  }

  next();
};

export const validateEscrowAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const jwtWalletAddress = getWalletAddressFromJWT(req);
  
  if (!jwtWalletAddress) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  next();
};