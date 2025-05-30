# Divvi Referrals API Documentation

## Overview

The Divvi Referrals API provides endpoints to submit, track, and manage referrals through the Divvi referral system. This API handles the integration with Divvi's `submitReferral` function and stores all submission attempts (successful or failed) for auditing and debugging purposes.

## Base URL

All endpoints are relative to your API base URL: `https://your-api-domain.com/api`

## Authentication

All endpoints require JWT authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### 1. Submit Referral

Submit a transaction to Divvi's referral system and store the result.

**Endpoint:** `POST /divvi-referrals`

**Headers:**
- `Authorization: Bearer <jwt-token>` (required)
- `Content-Type: application/json`

**Request Body:**
```json
{
  "transactionHash": "0x123abc...",  // Required: 64-character hex transaction hash
  "chainId": 42220,                  // Required: Chain ID (e.g., 42220 for Celo)
  "tradeId": 123                     // Optional: Associated trade ID
}
```

**Response (Success - 201):**
```json
{
  "success": true,
  "message": "Referral submitted successfully",
  "referral": {
    "id": 1,
    "wallet_address": "0x123...",
    "transaction_hash": "0x123abc...",
    "chain_id": 42220,
    "trade_id": 123,
    "submission_status": 200,
    "submission_response": {...},
    "submitted_providers_with_existing_referral": [],
    "error_message": null,
    "submitted_at": "2025-05-30T16:42:00Z",
    "created_at": "2025-05-30T16:42:00Z",
    "updated_at": "2025-05-30T16:42:00Z"
  },
  "hasExistingReferrals": false
}
```

**Response (Divvi Error - 400/500):**
```json
{
  "success": false,
  "message": "Referral submission failed",
  "referral": {
    "id": 1,
    "wallet_address": "0x123...",
    "transaction_hash": "0x123abc...",
    "chain_id": 42220,
    "trade_id": 123,
    "submission_status": 400,
    "submission_response": {...},
    "submitted_providers_with_existing_referral": null,
    "error_message": "Invalid transaction data",
    "submitted_at": "2025-05-30T16:42:00Z",
    "created_at": "2025-05-30T16:42:00Z",
    "updated_at": "2025-05-30T16:42:00Z"
  },
  "error": "Invalid transaction data"
}
```

**Error Responses:**

- `400 Bad Request`: Missing required fields or invalid transaction hash format
- `401 Unauthorized`: Invalid or missing JWT token
- `409 Conflict`: Referral already exists for this transaction
- `500 Internal Server Error`: Database or server error

### 2. Get User's Referrals

Retrieve all referrals for the authenticated user with pagination.

**Endpoint:** `GET /divvi-referrals`

**Headers:**
- `Authorization: Bearer <jwt-token>` (required)

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "wallet_address": "0x123...",
      "transaction_hash": "0x123abc...",
      "chain_id": 42220,
      "trade_id": 123,
      "submission_status": 200,
      "submission_response": {...},
      "submitted_providers_with_existing_referral": [],
      "error_message": null,
      "submitted_at": "2025-05-30T16:42:00Z",
      "created_at": "2025-05-30T16:42:00Z",
      "updated_at": "2025-05-30T16:42:00Z",
      "trade_exists": 123
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalCount": 25,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### 3. Get Specific Referral

Retrieve details of a specific referral (must be owned by authenticated user).

**Endpoint:** `GET /divvi-referrals/:id`

**Headers:**
- `Authorization: Bearer <jwt-token>` (required)

**Path Parameters:**
- `id`: Referral ID

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "wallet_address": "0x123...",
    "transaction_hash": "0x123abc...",
    "chain_id": 42220,
    "trade_id": 123,
    "submission_status": 200,
    "submission_response": {...},
    "submitted_providers_with_existing_referral": [],
    "error_message": null,
    "submitted_at": "2025-05-30T16:42:00Z",
    "created_at": "2025-05-30T16:42:00Z",
    "updated_at": "2025-05-30T16:42:00Z",
    "trade_exists": 123
  }
}
```

**Error Responses:**
- `401 Unauthorized`: Invalid or missing JWT token
- `404 Not Found`: Referral not found or not owned by user

## Admin Endpoints

Admin endpoints require admin role in JWT token.

### 1. Get All Referrals (Admin)

**Endpoint:** `GET /admin/divvi-referrals`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20, max: 100)
- `status` (optional): Filter by submission status (200, 400, 500)
- `chainId` (optional): Filter by chain ID
- `walletAddress` (optional): Filter by wallet address (partial match)

### 2. Get Referral Statistics (Admin)

**Endpoint:** `GET /admin/divvi-referrals/stats`

**Response:**
```json
{
  "success": true,
  "data": {
    "overall": {
      "total_referrals": 1000,
      "successful_referrals": 800,
      "bad_request_referrals": 150,
      "server_error_referrals": 50,
      "unknown_status_referrals": 0,
      "referrals_with_existing": 25
    },
    "byChain": [
      {
        "chain_id": 42220,
        "total_referrals": 800,
        "successful_referrals": 650
      }
    ],
    "recentActivity": [
      {
        "date": "2025-05-30",
        "referrals_count": 15,
        "successful_count": 12
      }
    ]
  },
  "timestamp": "2025-05-30T16:42:00Z"
}
```

## Integration Guide

### Frontend Integration Example

Replace your direct Divvi SDK usage with API calls:

**Before (Direct SDK):**
```typescript
import { submitReferral } from '@divvi/referral-sdk';

// Don't do this anymore
try {
  await submitReferral({ txHash, chainId });
  toast.success('Referral submitted!');
} catch (error) {
  toast.error('Referral failed');
}
```

**After (API Integration):**
```typescript
// New approach - call your API instead
const submitReferralToAPI = async (transactionHash: string, chainId: number, tradeId?: number) => {
  try {
    const response = await fetch('/api/divvi-referrals', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transactionHash,
        chainId,
        tradeId
      })
    });

    const data = await response.json();

    if (response.ok) {
      toast.success('Referral submitted successfully!');
      
      // Check if there were existing referrals
      if (data.hasExistingReferrals) {
        toast.info('Note: Some providers already had referrals for this transaction');
      }
      
      return data.referral;
    } else {
      // Handle different error types
      if (response.status === 409) {
        toast.error('Referral already exists for this transaction');
      } else if (response.status === 400) {
        toast.error('Invalid transaction data');
      } else {
        toast.error(data.error || 'Referral submission failed');
      }
      
      // Even failed submissions are stored for debugging
      return data.referral;
    }
  } catch (error) {
    console.error('API error:', error);
    toast.error('Network error - please try again');
    throw error;
  }
};

// Usage in your component
const handleCreateEscrowAndRefer = async () => {
  // ... your existing transaction logic ...
  
  // After transaction is confirmed
  try {
    const referral = await submitReferralToAPI(txHash, chainId, tradeId);
    console.log('Referral stored:', referral);
  } catch (error) {
    console.error('Referral submission failed:', error);
    // Don't block the user flow - referral failure shouldn't stop the main process
  }
};
```

### Error Handling Strategy

1. **Always store attempts**: The API stores both successful and failed referral attempts
2. **Don't block user flow**: Referral failures shouldn't prevent trade completion
3. **Provide user feedback**: Show success/warning messages based on submission status
4. **Handle duplicates gracefully**: 409 status means referral was already submitted

### Status Code Meanings

- **200**: Referral successfully submitted to Divvi
- **400**: Bad request (invalid transaction data, missing Divvi data suffix, etc.)
- **500**: Divvi server error
- **null**: Submission attempt failed before reaching Divvi (network issues, etc.)

### Best Practices

1. **Submit after transaction confirmation**: Only submit referrals after your transaction is confirmed on-chain
2. **Include trade association**: When possible, include `tradeId` to link referrals to specific trades
3. **Handle existing referrals**: Check `hasExistingReferrals` flag and inform users appropriately
4. **Monitor failures**: Use admin endpoints to monitor referral success rates
5. **Graceful degradation**: Don't let referral failures break your main user flow

### Monitoring and Debugging

Use the admin endpoints to:
- Monitor referral success rates by chain
- Identify problematic transactions (400 errors)
- Track Divvi system health (500 errors)
- Debug specific referral failures using the stored `submission_response`