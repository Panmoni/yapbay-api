# YapBay API Notes

## record all txs

Plan for Recording All Blockchain Transactions

1. Create a New Transaction Record Model
   First, we need to define a new model to store all blockchain transactions:

typescript
CopyInsert
// New Transaction Record Interface
export interface TransactionRecord {
id: number;
trade_id: number;
escrow_id?: number;
transaction_hash: string;
transaction_type: 'CREATE_ESCROW' | 'FUND_ESCROW' | 'MARK_FIAT_PAID' | 'RELEASE_ESCROW' | 'CANCEL_ESCROW' | 'DISPUTE_ESCROW' | 'RESOLVE_DISPUTE';
from_address: string;
to_address?: string;
amount?: string;
token_type?: string;
status: 'PENDING' | 'CONFIRMED' | 'FAILED';
block_number?: number;
block_timestamp?: string;
metadata?: Record<string, any>; // For any additional transaction-specific data
created_at: string;
updated_at: string;
} 2. Add a New API Endpoint
Add a new endpoint to src/api/index.ts for recording transactions:

typescript
CopyInsert
/\*\*

- Records a blockchain transaction
- @param data Transaction data to record
- @returns Promise with transaction recording response
  \*/
  export const recordTransaction = (data: {
  trade_id: number;
  escrow_id?: number;
  transaction_hash: string;
  transaction_type: 'CREATE_ESCROW' | 'FUND_ESCROW' | 'MARK_FIAT_PAID' | 'RELEASE_ESCROW' | 'CANCEL_ESCROW' | 'DISPUTE_ESCROW' | 'RESOLVE_DISPUTE';
  from_address: string;
  to_address?: string;
  amount?: string;
  token_type?: string;
  metadata?: Record<string, any>;
  }) =>
  api.post<{
  success: boolean;
  transactionId: number;
  txHash: string;
  blockNumber?: number;
  }>('/transactions/record', data);

// Get transactions for a trade
export const getTradeTransactions = (tradeId: number) =>
api.get<TransactionRecord[]>(`/transactions/trade/${tradeId}`);

// Get all user transactions
export const getUserTransactions = () =>
api.get<TransactionRecord[]>('/transactions/user'); 3. Modify Existing Service Functions
Update the tradeService.ts functions to use the new transaction recording endpoint. For each transaction type, we'll add a call to record the transaction after the blockchain operation completes.

Example for the createTradeEscrow function:

typescript
CopyInsert
export const createTradeEscrow = async ({
trade,
primaryWallet,
buyerAddress,
sellerAddress,
}: CreateEscrowParams) => {
try {
// Show notification message using toast
toast('Creating escrow on blockchain...', {
description: 'Please approve the transaction in your wallet.',
});

    // Create the escrow transaction on the blockchain
    const txResult = await createEscrowTransaction(primaryWallet, {
      tradeId: trade.id,
      buyer: buyerAddress,
      amount: parseFloat(trade.leg1_crypto_amount || '0'),
      sequential: false,
      sequentialEscrowAddress: undefined,
      arbitrator: config.arbitratorAddress || '0x0000000000000000000000000000000000000000',
    });

    console.log('[DEBUG] Transaction result:', txResult);

    // Record the transaction in our new system
    await recordTransaction({
      trade_id: trade.id,
      transaction_hash: txResult.txHash,
      transaction_type: 'CREATE_ESCROW',
      from_address: sellerAddress,
      to_address: txResult.escrowAddress, // Assuming this is returned
      amount: trade.leg1_crypto_amount,
      token_type: trade.leg1_crypto_token,
      metadata: {
        escrow_id: txResult.escrowId,
        buyer: buyerAddress,
        arbitrator: config.arbitratorAddress,
        sequential: false
      }
    });

    // For backward compatibility, still call the existing recordEscrow endpoint
    const recordData = {
      trade_id: trade.id,
      transaction_hash: txResult.txHash,
      escrow_id: txResult.escrowId,
      seller: sellerAddress,
      buyer: buyerAddress,
      amount: parseFloat(trade.leg1_crypto_amount || '0'),
      sequential: false,
      arbitrator: config.arbitratorAddress || '0x0000000000000000000000000000000000000000',
    };

    await recordEscrow(recordData);

    toast.success('Escrow created successfully!');

    return txResult;

} catch (err) {
// Error handling...
}
}; 4. Create a Transaction History Component
Create a new component to display transaction history for a trade:

tsx
CopyInsert
// src/components/TransactionHistory.tsx
import { useEffect, useState } from 'react';
import { getTradeTransactions, TransactionRecord } from '../api';
import { formatDate, formatAddress } from '../lib/utils';

interface TransactionHistoryProps {
tradeId: number;
}

export const TransactionHistory = ({ tradeId }: TransactionHistoryProps) => {
const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
const fetchTransactions = async () => {
try {
setLoading(true);
const response = await getTradeTransactions(tradeId);
setTransactions(response.data);
} catch (error) {
console.error('Error fetching transactions:', error);
} finally {
setLoading(false);
}
};

    fetchTransactions();

}, [tradeId]);

// Render transaction history UI
// ...
}; 5. Backend Implementation Plan
On the backend side, you'll need to:

Create a new database table for transaction records
Create a new API endpoint for recording transactions
Implement transaction querying endpoints
Add transaction status monitoring (optional) 6. Implementation Steps
Step 1: Define the transaction record interface in the frontend
Step 2: Add the new API endpoints to src/api/index.ts
Step 3: Update each transaction function in tradeService.ts to record transactions:
createTradeEscrow
markTradeFiatPaid
releaseTradeCrypto
disputeTrade
cancelTrade
Step 4: Create the transaction history component
Step 5: Integrate the transaction history component into the trade page
Step 6: Implement the backend changes (database and API endpoints) 7. Benefits of This Approach
Comprehensive Transaction History: Records all blockchain interactions
Improved Debugging: Easier to track and debug issues
Better User Experience: Users can see all their transaction history
Audit Trail: Complete record of all blockchain interactions for compliance
Analytics: Enables transaction analytics and reporting

## Refactor Routes

maybe use new middleware and services directories.

still got admin login in main routes

## Setup

<!-- tail -f api.log
tail -f events.log
psql -h localhost -U yapbay -d yapbay -->
