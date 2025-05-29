# Multi-Network Testing Documentation

## Overview

This document outlines the comprehensive testing strategy for YapBay API's multi-network functionality, covering network isolation, data integrity, and API endpoint validation.

## Test Structure

### Core Test Files

1. **`blockchain.test.ts`** - Basic blockchain connectivity and contract interaction tests
2. **`deadlineTrigger.test.ts`** - Network-aware deadline processing and cancellation tests  
3. **`multiNetwork.test.ts`** - Comprehensive multi-network isolation and data integrity tests
4. **`networkApi.test.ts`** - API endpoint testing with network headers and validation

## Test Categories

### 1. Network Service Tests (`multiNetwork.test.ts`)

**Network Configuration:**
- ✅ Retrieve active networks
- ✅ Get network by ID and name
- ✅ Validate network properties (chain ID, contract addresses)

**Celo Service Multi-Network:**
- ✅ Create separate providers for different networks
- ✅ Create separate contracts for different networks
- ✅ Verify different contract addresses per network

### 2. Data Isolation Tests (`multiNetwork.test.ts`)

**Offers Isolation:**
- ✅ Create offers on different networks
- ✅ Verify offers are only accessible within their network
- ✅ Confirm cross-network queries return empty results

**Trades Isolation:**
- ✅ Create trades on different networks
- ✅ Verify trades are only accessible within their network
- ✅ Confirm network-specific trade states and currencies

**Escrows Isolation:**
- ✅ Create escrows on different networks
- ✅ Verify escrows use correct contract addresses per network
- ✅ Confirm escrow states are network-specific

### 3. Deadline Processing Tests (`deadlineTrigger.test.ts`, `multiNetwork.test.ts`)

**Network-Aware Deadline Processing:**
- ✅ Process expired deadlines for specific networks only
- ✅ Verify trades on unprocessed networks remain unchanged
- ✅ Confirm deadline triggers respect network boundaries

**Legacy Compatibility:**
- ✅ Database triggers still block deadline violations
- ✅ Auto-cancellation respects uncancelable states
- ✅ Audit trail includes network context

### 4. API Endpoint Tests (`networkApi.test.ts`)

**Network Header Validation:**
- ✅ Reject invalid network names with proper error messages
- ✅ Use default network when no header provided
- ✅ Accept valid network names and return network context

**Endpoint Network Isolation:**
- ✅ `/offers` - Return only network-specific offers
- ✅ `/trades` - Return only network-specific trades
- ✅ `/my/trades` - Filter user trades by network
- ✅ Cross-network resource access returns 404

**Error Handling:**
- ✅ Graceful handling of network service errors
- ✅ Helpful error messages for missing/invalid networks
- ✅ Proper validation of network headers

### 5. Cross-Network Data Integrity Tests

**Resource Access Control:**
- ✅ Prevent access to resources from different networks
- ✅ Enforce network isolation in update operations
- ✅ Maintain referential integrity within networks

**Data Leakage Prevention:**
- ✅ Queries filtered by network_id prevent data leakage
- ✅ Update operations respect network boundaries
- ✅ Delete operations limited to correct network

## Running Tests

### Individual Test Suites

```bash
# Run all tests
npm run test

# Run specific test files
npm run test:blockchain
npm run test:deadline

# Run blockchain connectivity tests
npx mocha -r ts-node/register 'src/tests/blockchain.test.ts'

# Run multi-network tests
npx mocha -r ts-node/register 'src/tests/multiNetwork.test.ts'

# Run API tests
npx mocha -r ts-node/register 'src/tests/networkApi.test.ts'

# Run deadline tests
npx mocha -r ts-node/register 'src/tests/deadlineTrigger.test.ts'
```

### Test Scripts

```bash
# Test deadline service functionality
npm run test:deadline

# Test database connections
npm run test:connection

# Test escrow monitoring
npm run test:escrow-monitoring
```

## Test Data Requirements

### Database Setup

Tests require active network configurations in the `networks` table:
- Celo Alfajores (ID: 1, Chain: 44787)
- Celo Mainnet (ID: 2, Chain: 42220)

### Environment Variables

```env
# Database connection
POSTGRES_URL=postgres://user:pass@localhost:5432/yapbay

# Network configurations (from database)
CELO_RPC_URL_TESTNET=https://alfajores-forno.celo-testnet.org
CELO_RPC_URL=https://forno.celo.org

# Contract addresses (from database)
CONTRACT_ADDRESS_TESTNET=0xE68cf67df40B3d93Be6a10D0A18d0846381Cbc0E
CONTRACT_ADDRESS=0xf8C832021350133769EE5E0605a9c40c1765ace7
```

## Test Coverage

### Network Isolation ✅
- [x] Data separated by network_id
- [x] Cross-network queries return empty results
- [x] API endpoints respect network headers
- [x] Update operations limited to correct network

### Service Layer ✅
- [x] NetworkService manages configurations correctly
- [x] CeloService creates separate providers per network
- [x] DeadlineService processes networks independently
- [x] Database queries include network filtering

### Error Handling ✅
- [x] Invalid network names rejected
- [x] Missing network headers handled gracefully
- [x] Network service errors don't crash application
- [x] Helpful error messages provided

### Backward Compatibility ✅
- [x] Existing functions work with multi-network updates
- [x] Default network fallback functions correctly
- [x] Database triggers still enforce deadlines
- [x] Audit trails include network context

## Test Scenarios

### End-to-End Network Isolation

1. **Setup**: Create test data on both networks
2. **Action**: Query data with different network headers
3. **Verify**: Only network-specific data returned

### Cross-Network Prevention

1. **Setup**: Create resource on Network A
2. **Action**: Try to access from Network B
3. **Verify**: 404 error returned

### Deadline Processing Isolation

1. **Setup**: Create expired trades on both networks
2. **Action**: Process deadlines for one network only
3. **Verify**: Other network's trades remain unchanged

### API Header Validation

1. **Setup**: Valid API endpoint
2. **Action**: Send request with invalid network header
3. **Verify**: 400 error with helpful message

## Known Limitations

- Tests use mock JWT tokens for authentication
- Some tests require actual blockchain connectivity
- Database transactions are rolled back after each test
- Network configurations must exist in database

## Future Test Enhancements

- [ ] Add performance tests for multi-network operations
- [ ] Test network switching scenarios
- [ ] Add load testing for concurrent network operations
- [ ] Test network deactivation/reactivation scenarios
- [ ] Add integration tests with actual blockchain calls