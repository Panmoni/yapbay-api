# YapBay API Reference

## Authentication
All endpoints except those marked as public require a valid JWT token in the Authorization header:
```
Authorization: Bearer <jwt_token>
```

## Public Endpoints

### Health Check
```http
GET /health
```
Returns the health status of the API, including database connectivity and network status.

### Prices
```http
GET /prices
```
Returns current USDC prices in various fiat currencies (USD, COP, EUR, NGN, VES).

## Account Management

### Create Account
```http
POST /accounts
Content-Type: application/json

{
  "wallet_address": "0x...",
  "username": "string",
  "email": "string"
}
```

### Get My Account
```http
GET /accounts/me
```

### Get Account by ID
```http
GET /accounts/:id
```

### Update Account
```http
PUT /accounts/:id
Content-Type: application/json

{
  "username": "string",
  "email": "string",
  "telegram_username": "string",
  "telegram_id": "string",
  "profile_photo_url": "string",
  "phone_country_code": "string",
  "phone_number": "string",
  "available_from": "string",
  "available_to": "string",
  "timezone": "string"
}
```

## Offers

### Create Offer
```http
POST /offers
Content-Type: application/json

{
  "creator_account_id": number,
  "offer_type": "BUY" | "SELL",
  "token": "USDC",
  "fiat_currency": "USD",
  "min_amount": "string (decimal, up to 6dp)",
  "max_amount": "string (decimal, optional)",
  "total_available_amount": "string (decimal, optional)",
  "rate_adjustment": "number (optional)",
  "terms": "string (optional)",
  "token": "USDC (optional)",
  "fiat_currency": "USD (3-letter ISO, optional)",
  "escrow_deposit_time_limit": "string (optional)",
  "fiat_payment_time_limit": "string (optional)"
}
```

### List Offers
```http
GET /offers
Query Parameters:
- owner: "me" (optional)
- type: "BUY" | "SELL" (optional)
```

### Get Offer Details
```http
GET /offers/:id
```

### Update Offer
```http
PUT /offers/:id
Content-Type: application/json

{
  "min_amount": number,
  "max_amount": number,
  "total_available_amount": number,
  "rate_adjustment": number,
  "terms": string,
  "escrow_deposit_time_limit": string,
  "fiat_payment_time_limit": string,
  "fiat_currency": string,
  "offer_type": "BUY" | "SELL",
  "token": string
}
```

### Delete Offer
```http
DELETE /offers/:id
```

## Trades

### Create Trade
```http
POST /trades
Content-Type: application/json

{
  "leg1_offer_id": "number (required)",
  "leg2_offer_id": "number (optional)",
  "leg1_crypto_amount": "string (decimal, optional)",
  "leg1_fiat_amount": "string (decimal 2dp, optional)",
  "from_fiat_currency": "string (3-letter ISO, optional)",
  "destination_fiat_currency": "string (3-letter ISO, optional)",
  "from_bank": "string (optional)",
  "destination_bank": "string (optional)"
}
```

### List My Trades
```http
GET /my/trades
```

### Get Trade Details
```http
GET /trades/:id
```

### Mark Fiat Paid
```http
PUT /trades/:id
Content-Type: application/json

{
  "fiat_paid": boolean
}
```

## Escrows

### Record Escrow
```http
POST /escrows/record
Content-Type: application/json

{
  // EVM variant:
  "trade_id": "number",
  "transaction_hash": "0x... (66 chars)",
  "escrow_id": "hex string",
  "seller": "0x... (EVM address)",
  "buyer": "0x... (EVM address)",
  "amount": "string (decimal, max 100.000000)",
  "sequential": "boolean (optional, default false)",
  "sequential_escrow_address": "0x... (optional, required if sequential=true)"

  // Solana variant:
  "trade_id": "number",
  "signature": "base58 (87-88 chars)",
  "escrow_id": "string (u64 decimal)",
  "seller": "base58 (Solana address)",
  "buyer": "base58 (Solana address)",
  "amount": "string (decimal, max 100.000000)",
  "program_id": "base58 (Solana program ID)",
  "escrow_pda": "base58 (Solana PDA)",
  "escrow_token_account": "base58 (Solana PDA)",
  "trade_onchain_id": "string (u64 decimal)",
  "sequential": "boolean (optional)",
  "sequential_escrow_address": "base58 (optional)"
}
```

### List My Escrows
```http
GET /escrows/my
```

### Get Escrow Balance
```http
GET /escrows/:onchainEscrowId/balance
```

### Get Stored Escrow Balance
```http
GET /escrows/:onchainEscrowId/stored-balance
```

### Get Calculated Escrow Balance
```http
GET /escrows/:onchainEscrowId/calculated-balance
```

### Get Sequential Escrow Info
```http
GET /escrows/:onchainEscrowId/sequential-info
```

### Check Auto-Cancel Eligibility
```http
GET /escrows/:onchainEscrowId/auto-cancel-eligible
```

## Transactions

### Record Transaction
```http
POST /transactions
Content-Type: application/json

{
  "trade_id": number,
  "escrow_id": number,
  "transaction_hash": "0x...",
  "transaction_type": "CREATE_ESCROW" | "FUND_ESCROW" | "MARK_FIAT_PAID" | "RELEASE_ESCROW" | "CANCEL_ESCROW" | "DISPUTE_ESCROW" | "OPEN_DISPUTE" | "RESPOND_DISPUTE" | "RESOLVE_DISPUTE" | "OTHER",
  "from_address": "0x...",
  "to_address": "0x...",
  "block_number": number,
  "metadata": object,
  "status": "PENDING" | "SUCCESS" | "FAILED"
}
```

### Get Trade Transactions
```http
GET /transactions/trade/:id
Query Parameters:
- type: string (optional) - Filter by transaction type
```

### Get User Transactions
```http
GET /transactions/user
Query Parameters:
- type: string (optional) - Filter by transaction type
- limit: number (default: 50) - Number of transactions to return
- offset: number (default: 0) - Number of transactions to skip
```

## Referrals

### Submit Divvi Referral
```http
POST /divvi-referrals
Content-Type: application/json

{
  "transactionHash": "0x...",
  "chainId": number,
  "tradeId": number
}
```

### List My Divvi Referrals
```http
GET /divvi-referrals
Query Parameters:
- page: number (default: 1)
- limit: number (default: 10)
```

### Get Divvi Referral Details
```http
GET /divvi-referrals/:id
```

## Admin Endpoints

### List Trades (Admin)
```http
GET /admin/trades
Query Parameters:
- page: number (default: 1)
- limit: number (default: 10)
```

## Network Support
Endpoints that require network context use the `X-Network-Name` header:
```
X-Network-Name: solana-devnet
```
Valid values: `celo-alfajores`, `celo-mainnet`, `solana-devnet`, `solana-mainnet`.

## Validation

All request inputs (body, query, params, headers) are validated using Zod 4 schemas. Strict mode is enforced — unknown fields in request bodies are rejected with a 400.

USDC amounts are **strings** (decimal format, up to 6 decimal places) to preserve precision. Sending numeric amounts will be rejected.

## Error Responses

### Validation Errors (400)
```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid request body",
    "details": {
      "request_id": "req_...",
      "timestamp": "2025-01-01T00:00:00.000Z",
      "path": "/offers",
      "method": "POST"
    },
    "issues": [
      {
        "path": "body.min_amount",
        "code": "invalid_string",
        "message": "USDC amount must be a decimal string with up to 6 fractional digits"
      }
    ]
  }
}
```

### General Errors
```json
{
  "error": {
    "code": "string",
    "message": "Error description",
    "details": {
      "request_id": "req_...",
      "timestamp": "...",
      "path": "...",
      "method": "..."
    }
  }
}
```

Common HTTP Status Codes:
- 200: Success
- 201: Created
- 400: Bad Request / Validation Error
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error / Response Validation Error