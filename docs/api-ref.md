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
  "min_amount": number,
  "max_amount": number,
  "total_available_amount": number,
  "rate_adjustment": number,
  "terms": string,
  "escrow_deposit_time_limit": string,
  "fiat_payment_time_limit": string
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
  "leg1_offer_id": number,
  "leg1_crypto_amount": number,
  "from_fiat_currency": "USD"
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
  "trade_id": number,
  "transaction_hash": "0x...",
  "escrow_id": string,
  "seller": "0x...",
  "buyer": "0x...",
  "amount": number,
  "sequential": boolean,
  "sequential_escrow_address": "0x..."
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
All endpoints support network selection through the `X-Network-ID` header. If not provided, the default network will be used.

## Error Responses
All endpoints return errors in the following format:
```json
{
  "error": "Error message",
  "details": "Optional detailed error information"
}
```

Common HTTP Status Codes:
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error