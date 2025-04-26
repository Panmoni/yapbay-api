# Transaction API Documentation

This document outlines the API endpoints for recording and retrieving blockchain transactions in the YapBay system.

## Transaction Types

The system supports the following transaction types:

- `CREATE_ESCROW`: Creating a new escrow
- `FUND_ESCROW`: Funding an existing escrow
- `MARK_FIAT_PAID`: Marking fiat as paid
- `RELEASE_ESCROW`: Releasing funds from escrow
- `CANCEL_ESCROW`: Cancelling an escrow
- `DISPUTE_ESCROW`: Opening a dispute
- `OPEN_DISPUTE`: Alternative name for opening a dispute
- `RESPOND_DISPUTE`: Responding to a dispute
- `RESOLVE_DISPUTE`: Resolving a dispute
- `OTHER`: Other transaction types

## Transaction Statuses

Transactions can have the following statuses:

- `PENDING`: Transaction has been submitted but not confirmed
- `SUCCESS`: Transaction has been confirmed successfully
- `FAILED`: Transaction failed

## API Endpoints

### Record a Transaction

Records a blockchain transaction in the system.

**URL**: `/transactions/record`

**Method**: `POST`

**Authentication**: JWT token required

**Request Body**:

```json
{
  "trade_id": 123,                                  // Required: ID of the trade associated with this transaction
  "escrow_id": 456,                                 // Optional: ID of the escrow if applicable
  "transaction_hash": "0x123...",                   // Required: Blockchain transaction hash
  "transaction_type": "FUND_ESCROW",                // Required: One of the transaction types listed above
  "from_address": "0xabc...",                       // Required: Sender's wallet address
  "to_address": "0xdef...",                         // Optional: Receiver's wallet address or contract address
  "amount": "100",                                  // Optional: Amount involved in the transaction
  "token_type": "USDC",                             // Optional: Type of token (e.g., USDC, ETH)
  "block_number": 12345678,                         // Optional: Block number where transaction was confirmed
  "status": "SUCCESS",                              // Optional: Transaction status (defaults to PENDING)
  "metadata": {                                     // Optional: Additional transaction-specific data
    "key1": "value1",
    "key2": "value2"
  }
}
```

**Success Response**:

- **Code**: 201 Created
- **Content**:

```json
{
  "success": true,
  "transactionId": 789,                             // Database ID of the recorded transaction
  "txHash": "0x123...",                             // Transaction hash (same as input)
  "blockNumber": 12345678                           // Block number (if provided)
}
```

**Error Responses**:

- **Code**: 400 Bad Request
  - Missing required fields
  - Invalid transaction type
  - Invalid status
- **Code**: 404 Not Found
  - Trade not found
  - Escrow not found (if escrow_id was provided)
- **Code**: 500 Internal Server Error
  - Database operation failed
  - Other server errors

### Get Transactions for a Trade

Retrieves all transactions associated with a specific trade.

**URL**: `/transactions/trade/:id`

**Method**: `GET`

**Authentication**: JWT token required

**URL Parameters**:
- `id`: ID of the trade

**Query Parameters**:
- `type`: Optional filter by transaction type

**Success Response**:

- **Code**: 200 OK
- **Content**:

```json
[
  {
    "id": 789,
    "transaction_hash": "0x123...",
    "status": "SUCCESS",
    "transaction_type": "FUND_ESCROW",
    "block_number": 12345678,
    "from_address": "0xabc...",
    "to_address": "0xdef...",
    "gas_used": "21000",
    "error_message": null,
    "trade_id": 123,
    "escrow_id": 456,
    "created_at": "2025-04-26T22:41:27Z",
    "metadata": {
      "key1": "value1",
      "key2": "value2"
    }
  },
  // Additional transactions...
]
```

**Error Responses**:

- **Code**: 404 Not Found
  - Trade not found
- **Code**: 500 Internal Server Error
  - Database operation failed
  - Other server errors

### Get User Transactions

Retrieves all transactions associated with the authenticated user.

**URL**: `/transactions/user`

**Method**: `GET`

**Authentication**: JWT token required

**Query Parameters**:
- `type`: Optional filter by transaction type
- `limit`: Optional limit on number of results (default: 50)
- `offset`: Optional offset for pagination (default: 0)

**Success Response**:

- **Code**: 200 OK
- **Content**:

```json
[
  {
    "id": 789,
    "transaction_hash": "0x123...",
    "status": "SUCCESS",
    "transaction_type": "FUND_ESCROW",
    "block_number": 12345678,
    "from_address": "0xabc...",
    "to_address": "0xdef...",
    "gas_used": "21000",
    "error_message": null,
    "trade_id": 123,
    "escrow_id": 456,
    "created_at": "2025-04-26T22:41:27Z",
    "amount": "100",
    "token_type": "USDC",
    "metadata": {
      "key1": "value1",
      "key2": "value2"
    }
  },
  // Additional transactions...
]
```

**Error Responses**:

- **Code**: 401 Unauthorized
  - Authentication required
- **Code**: 500 Internal Server Error
  - Database operation failed
  - Other server errors

## Frontend Integration

Here's how to integrate these endpoints in your frontend code:

```typescript
// Transaction Record Interface
export interface TransactionRecord {
  id: number;
  trade_id: number;
  escrow_id?: number;
  transaction_hash: string;
  transaction_type: 'CREATE_ESCROW' | 'FUND_ESCROW' | 'MARK_FIAT_PAID' | 'RELEASE_ESCROW' | 'CANCEL_ESCROW' | 'DISPUTE_ESCROW' | 'OPEN_DISPUTE' | 'RESPOND_DISPUTE' | 'RESOLVE_DISPUTE' | 'OTHER';
  from_address: string;
  to_address?: string;
  amount?: string;
  token_type?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  block_number?: number;
  gas_used?: string;
  error_message?: string;
  created_at: string;
  metadata?: Record<string, any>; // For any additional transaction-specific data
}

// API Functions
export const recordTransaction = (data: {
  trade_id: number;
  escrow_id?: number;
  transaction_hash: string;
  transaction_type: 'CREATE_ESCROW' | 'FUND_ESCROW' | 'MARK_FIAT_PAID' | 'RELEASE_ESCROW' | 'CANCEL_ESCROW' | 'DISPUTE_ESCROW' | 'OPEN_DISPUTE' | 'RESPOND_DISPUTE' | 'RESOLVE_DISPUTE' | 'OTHER';
  from_address: string;
  to_address?: string;
  amount?: string;
  token_type?: string;
  block_number?: number;
  status?: 'PENDING' | 'SUCCESS' | 'FAILED';
  metadata?: Record<string, any>;
}) => api.post<{
  success: boolean;
  transactionId: number;
  txHash: string;
  blockNumber?: number;
}>('/transactions/record', data);

// Get transactions for a trade
export const getTradeTransactions = (tradeId: number, type?: string) => 
  api.get<TransactionRecord[]>(`/transactions/trade/${tradeId}${type ? `?type=${type}` : ''}`);

// Get all user transactions
export const getUserTransactions = (params?: { 
  type?: string; 
  limit?: number; 
  offset?: number; 
}) => {
  const queryParams = new URLSearchParams();
  if (params?.type) queryParams.append('type', params.type);
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.offset) queryParams.append('offset', params.offset.toString());
  
  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
  return api.get<TransactionRecord[]>(`/transactions/user${queryString}`);
};
```

## Usage Example

Here's an example of how to use these functions in your frontend code:

```typescript
// Example: Record a transaction when creating an escrow
export const createTradeEscrow = async ({
  trade,
  primaryWallet,
  buyerAddress,
  sellerAddress,
}: CreateEscrowParams) => {
  try {
    // Show notification message
    toast('Creating escrow on blockchain...');

    // Create the escrow transaction on the blockchain
    const txResult = await createEscrowTransaction(primaryWallet, {
      tradeId: trade.id,
      buyer: buyerAddress,
      amount: parseFloat(trade.leg1_crypto_amount || '0'),
      arbitrator: config.arbitratorAddress,
    });

    // Record the transaction in our system
    await recordTransaction({
      trade_id: trade.id,
      transaction_hash: txResult.txHash,
      transaction_type: 'CREATE_ESCROW',
      from_address: sellerAddress,
      to_address: txResult.escrowAddress,
      amount: trade.leg1_crypto_amount,
      token_type: trade.leg1_crypto_token,
      status: 'SUCCESS',
      metadata: {
        escrow_id: txResult.escrowId,
        buyer: buyerAddress,
        arbitrator: config.arbitratorAddress
      }
    });

    toast.success('Escrow created successfully!');
    return txResult;
  } catch (err) {
    // Error handling...
  }
};

// Example: Display transaction history for a trade
const TradeTransactionHistory = ({ tradeId }) => {
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

  // Render transaction history...
};
```
