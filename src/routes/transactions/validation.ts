import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';

export const validateTransactionRecord = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const {
    trade_id,
    transaction_hash,
    transaction_type,
    from_address,
    status = 'PENDING'
  } = req.body;

  // Collect validation errors to provide comprehensive feedback
  const validationErrors: { field: string; message: string }[] = [];

  // Validate required fields
  if (!transaction_hash) {
    validationErrors.push({ field: 'transaction_hash', message: 'Transaction hash is required' });
  }
  
  if (!transaction_type) {
    validationErrors.push({ field: 'transaction_type', message: 'Transaction type is required' });
  }
  
  if (!from_address) {
    validationErrors.push({ field: 'from_address', message: 'From address is required' });
  }
  
  if (!trade_id) {
    validationErrors.push({ field: 'trade_id', message: 'Trade ID is required' });
  }

  // Validate transaction type
  const validTransactionTypes = [
    'CREATE_ESCROW', 
    'FUND_ESCROW', 
    'MARK_FIAT_PAID', 
    'RELEASE_ESCROW', 
    'CANCEL_ESCROW', 
    'DISPUTE_ESCROW', 
    'OPEN_DISPUTE', 
    'RESPOND_DISPUTE', 
    'RESOLVE_DISPUTE', 
    'OTHER'
  ];
  
  if (transaction_type && !validTransactionTypes.includes(transaction_type)) {
    validationErrors.push({
      field: 'transaction_type',
      message: `Transaction type must be one of: ${validTransactionTypes.join(', ')}`
    });
  }

  // Validate status
  const validStatuses = ['PENDING', 'SUCCESS', 'FAILED'];
  if (status && !validStatuses.includes(status)) {
    validationErrors.push({
      field: 'status',
      message: `Status must be one of: ${validStatuses.join(', ')}`
    });
  }

  // Validate trade_id is a number
  if (trade_id && !Number.isInteger(Number(trade_id))) {
    validationErrors.push({
      field: 'trade_id',
      message: 'Trade ID must be an integer'
    });
  }

  // If we have validation errors, return them
  if (validationErrors.length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      details: 'One or more required fields are missing or invalid',
      validationErrors
    });
    return;
  }

  next();
};