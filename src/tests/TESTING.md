# YapBay API Testing Guide

## Overview

This document provides comprehensive guidance for testing the YapBay API, with a focus on Solana network integration and multi-network testing capabilities.

## Table of Contents

1. [Test Environment Setup](#test-environment-setup)
2. [Solana Network Testing](#solana-network-testing)
3. [Test Utilities](#test-utilities)
4. [Database Testing](#database-testing)
5. [Multi-Network Testing](#multi-network-testing)
6. [Environment Variables](#environment-variables)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

## Test Environment Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 13+
- TypeScript 4.9+
- Mocha test framework
- Chai assertion library

### Database Setup

The test suite requires a PostgreSQL database with the complete schema. Use the provided `schema.sql` file:

```bash
# Reset database to clean state
psql -h localhost -U your_user -d your_database -f schema.sql
```

### Environment Variables

Create a `.env.test` file with the following variables:

```bash
# Database
POSTGRES_URL=postgresql://user:password@localhost:5432/yapbay_test

# Solana Networks
SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com
SOLANA_MAINNET_RPC_URL=https://api.mainnet-beta.solana.com

# Solana Program Configuration
SOLANA_PROGRAM_ID=4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x
SOLANA_USDC_MINT_DEVNET=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
SOLANA_USDC_MINT_MAINNET=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
SOLANA_ARBITRATOR_ADDRESS=GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr

# Test Configuration
NODE_ENV=test
LOG_LEVEL=error
```

## Solana Network Testing

### Network Configuration

The test suite supports two Solana networks:

1. **Solana Devnet** (ID: 1, Chain ID: 101)

   - Active for testing
   - Uses test USDC mint
   - RPC: `https://api.devnet.solana.com`

2. **Solana Mainnet** (ID: 2, Chain ID: 102)
   - Inactive by default
   - Uses real USDC mint
   - RPC: `https://api.mainnet-beta.solana.com`

### Solana-Specific Test Scenarios

#### Address Validation

```typescript
import { SolanaBlockchainService } from '../services/blockchainService';

const service = new SolanaBlockchainService();
const validAddress = '11111111111111111111111111111112'; // Solana System Program
const invalidAddress = 'invalid-address';

expect(service.validateAddress(validAddress)).to.be.true;
expect(service.validateAddress(invalidAddress)).to.be.false;
```

#### Transaction Signature Validation

```typescript
const validSignature =
  '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjJfq4MZWMbbKyggtKVEznR3W3HoqKMMyRkACdzh54smHiBJRUxDi';
const invalidSignature = 'invalid-signature';

expect(service.validateTransactionHash(validSignature)).to.be.true;
expect(service.validateTransactionHash(invalidSignature)).to.be.false;
```

## Test Utilities

### Solana Test Utilities (`src/tests/utils/solanaTestUtils.ts`)

The test utilities provide comprehensive functions for creating and managing test data:

#### Account Creation

```typescript
import { createTestAccount } from './utils/solanaTestUtils';

const account = await createTestAccount(client, {
  username: 'testuser',
  email: 'test@example.com',
});
```

#### Complete Test Scenario

```typescript
import { createCompleteTestScenario } from './utils/solanaTestUtils';

const scenario = await createCompleteTestScenario(client, 1, {
  sellerAccount: { username: 'seller' },
  buyerAccount: { username: 'buyer' },
  offer: { token: 'USDC', fiat_currency: 'USD' },
});
```

#### Data Cleanup

```typescript
import { cleanupTestData } from './utils/solanaTestUtils';

await cleanupTestData(client, {
  accountIds: [account.id],
  offerIds: [offer.id],
  tradeIds: [trade.id],
  escrowIds: [escrow.id],
});
```

## Database Testing

### Network Isolation

All database operations must respect network isolation:

```typescript
// Correct: Filter by network_id
const offers = await client.query('SELECT * FROM offers WHERE network_id = $1', [networkId]);

// Incorrect: Cross-network data access
const offers = await client.query('SELECT * FROM offers');
```

### Address Format Compatibility

Solana addresses are 44 characters, EVM addresses are 42 characters:

```typescript
// Solana address (44 chars)
const solanaAddress = '11111111111111111111111111111112';

// EVM address (42 chars)
const evmAddress = '0x1234567890123456789012345678901234567890';

// Database columns support both formats
const wallet_address VARCHAR(44) -- Supports both EVM (42) and Solana (44)
```

## Multi-Network Testing

### Network Service Integration

```typescript
import { NetworkService } from '../services/networkService';

const networkService = new NetworkService();

// Get all active networks
const networks = await networkService.getActiveNetworks();
expect(networks).to.have.length.greaterThan(0);

// Get Solana networks
const solanaNetworks = await networkService.getNetworksByFamily('solana');
expect(solanaNetworks.every(n => n.networkFamily === 'solana')).to.be.true;
```

### Cross-Network Data Isolation

```typescript
// Create data on different networks
const devnetOffer = await createTestOffer(client, {
  creator_account_id: account.id,
  network_id: 1, // Solana Devnet
});

const mainnetOffer = await createTestOffer(client, {
  creator_account_id: account.id,
  network_id: 2, // Solana Mainnet
});

// Verify isolation
const devnetOffers = await client.query('SELECT * FROM offers WHERE network_id = $1', [1]);
expect(devnetOffers.rows).to.have.length(1);
expect(devnetOffers.rows[0].id).to.equal(devnetOffer.id);
```

## Environment Variables

### Required Variables

| Variable                    | Description                 | Example                                        |
| --------------------------- | --------------------------- | ---------------------------------------------- |
| `POSTGRES_URL`              | Database connection string  | `postgresql://user:pass@localhost:5432/db`     |
| `SOLANA_DEVNET_RPC_URL`     | Solana Devnet RPC endpoint  | `https://api.devnet.solana.com`                |
| `SOLANA_MAINNET_RPC_URL`    | Solana Mainnet RPC endpoint | `https://api.mainnet-beta.solana.com`          |
| `SOLANA_PROGRAM_ID`         | YapBay program ID           | `4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x` |
| `SOLANA_USDC_MINT_DEVNET`   | Devnet USDC mint address    | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| `SOLANA_USDC_MINT_MAINNET`  | Mainnet USDC mint address   | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `SOLANA_ARBITRATOR_ADDRESS` | Arbitrator wallet address   | `GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr` |

## Best Practices

### 1. Network Isolation

Always filter database queries by `network_id`:

```typescript
// ✅ Good
const offers = await client.query(
  'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
  [networkId, accountId]
);

// ❌ Bad
const offers = await client.query('SELECT * FROM offers WHERE creator_account_id = $1', [
  accountId,
]);
```

### 2. Address Validation

Always validate addresses before database operations:

```typescript
import { SolanaBlockchainService } from '../services/blockchainService';

const service = new SolanaBlockchainService();
if (!service.validateAddress(address)) {
  throw new Error('Invalid Solana address');
}
```

### 3. Test Data Management

```typescript
describe('Test Suite', function () {
  let testData: {
    accountIds: number[];
    offerIds: number[];
    tradeIds: number[];
    escrowIds: number[];
  };

  beforeEach(async function () {
    testData = {
      accountIds: [],
      offerIds: [],
      tradeIds: [],
      escrowIds: [],
    };
  });

  afterEach(async function () {
    // Clean up all test data
    await cleanupTestData(client, testData);
  });
});
```

## Troubleshooting

### Common Issues

#### 1. Database Connection Errors

**Error**: `Connection terminated unexpectedly`

**Solution**: Check PostgreSQL is running and connection string is correct:

```bash
# Test connection
psql -h localhost -U your_user -d your_database -c "SELECT 1;"
```

#### 2. Network Configuration Errors

**Error**: `Network with ID X not found`

**Solution**: Verify network exists in database:

```sql
SELECT * FROM networks WHERE id = 1;
```

#### 3. Address Validation Errors

**Error**: `Invalid Solana address`

**Solution**: Use valid Solana addresses (44 characters, base58):

```typescript
// Valid Solana System Program address
const validAddress = '11111111111111111111111111111112';
```

#### 4. Database Constraint Violations

**Error**: `null value in column "network_id" violates not-null constraint`

**Solution**: Always provide required fields:

```typescript
const transaction = await createTestTransaction(client, {
  network_id: 1, // Always provide network_id
  transaction_hash: '...',
  status: 'SUCCESS',
  type: 'CREATE_ESCROW',
});
```

## Test Execution

### Running All Tests

```bash
npm test
```

### Running Specific Test Suites

```bash
# Solana network tests
npm test -- --grep "Solana Network"

# Multi-network tests
npm test -- --grep "Multi-Network"
```

## Conclusion

This testing guide provides comprehensive coverage for Solana network integration and multi-network testing. Follow the best practices and use the provided utilities to ensure robust, maintainable tests.
