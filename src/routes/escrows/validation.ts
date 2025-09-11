import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { ethers } from 'ethers';
import { NetworkValidator } from '../../validation/networkValidation';
import { NetworkService } from '../../services/networkService';

export const validateEscrowRecord = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const {
    trade_id,
    transaction_hash,
    signature,
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

  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }

  if (!seller || jwtWalletAddress.toLowerCase() !== seller.toLowerCase()) {
    res.status(403).json({ error: 'Seller must match authenticated user and be provided' });
    return;
  }

  if (!Number.isInteger(Number(trade_id))) {
    res.status(400).json({ error: 'trade_id must be an integer' });
    return;
  }

  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  try {
    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      res.status(400).json({ error: 'Invalid network' });
      return;
    }
    const networkFamily = network.networkFamily;

    // Network-specific transaction validation
    if (networkFamily === 'evm') {
      if (!transaction_hash || !NetworkValidator.validateTransactionHash(transaction_hash, 'evm')) {
        res.status(400).json({ error: 'Valid EVM transaction_hash must be provided' });
        return;
      }
    } else if (networkFamily === 'solana') {
      if (!signature || !NetworkValidator.validateTransactionHash(signature, 'solana')) {
        res.status(400).json({ error: 'Valid Solana signature must be provided' });
        return;
      }

      // Validate Solana-specific fields
      if (!program_id || !NetworkValidator.validateProgramId(program_id)) {
        res.status(400).json({ error: 'Valid program_id must be provided for Solana' });
        return;
      }

      if (!escrow_pda || !NetworkValidator.validatePDA(escrow_pda)) {
        res.status(400).json({ error: 'Valid escrow_pda must be provided for Solana' });
        return;
      }

      if (!escrow_token_account || !NetworkValidator.validatePDA(escrow_token_account)) {
        res.status(400).json({ error: 'Valid escrow_token_account must be provided for Solana' });
        return;
      }

      if (!trade_onchain_id || !NetworkValidator.validateEscrowId(trade_onchain_id, 'solana')) {
        res.status(400).json({ error: 'Valid trade_onchain_id must be provided for Solana' });
        return;
      }
    }

    // Network-specific address validation
    if (!NetworkValidator.validateAddress(buyer, networkFamily)) {
      res
        .status(400)
        .json({ error: `buyer must be a valid ${networkFamily.toUpperCase()} address` });
      return;
    }

    // Network-specific escrow ID validation
    if (!NetworkValidator.validateEscrowId(escrow_id, networkFamily)) {
      res
        .status(400)
        .json({ error: `escrow_id must be valid for ${networkFamily.toUpperCase()} network` });
      return;
    }

    // Sequential address validation
    if (sequential === true && !sequential_escrow_address) {
      res
        .status(400)
        .json({ error: 'sequential_escrow_address must be provided when sequential is true' });
      return;
    }

    if (
      sequential_escrow_address &&
      !NetworkValidator.validateAddress(sequential_escrow_address, networkFamily)
    ) {
      res.status(400).json({
        error: `sequential_escrow_address must be a valid ${networkFamily.toUpperCase()} address`,
      });
      return;
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Failed to validate network configuration' });
    return;
  }
};

export const validateEscrowAccess = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const jwtWalletAddress = getWalletAddressFromJWT(req);

  if (!jwtWalletAddress) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  next();
};
