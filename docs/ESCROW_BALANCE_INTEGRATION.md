# Escrow Balance and Monitoring Integration

## Overview

This document outlines the comprehensive integration of new escrow balance functions, monitoring capabilities, and auto-cancellation features into the YapBay API system.

## Contract Changes Integrated

### New Contract Functions
- `getStoredEscrowBalance(uint256 _escrowId)` - Returns the tracked balance from the contract's internal mapping
- `getCalculatedEscrowBalance(uint256 _escrowId)` - Returns the expected balance based on escrow state
- `getSequentialEscrowInfo(uint256 _escrowId)` - Returns sequential escrow details and target balance
- `isEligibleForAutoCancel(uint256 _escrowId)` - Checks if an escrow can be auto-cancelled

### New Contract Events
- `EscrowBalanceChanged(uint256 indexed escrowId, uint256 newBalance, string reason)` - Emitted when escrow balance changes

## API Integration Updates

### New REST Endpoints

#### 1. Enhanced Balance Endpoint
**GET** `/escrows/:onchainEscrowId/balance`
- **Enhanced**: Now returns both database and contract balance data
- **Response**:
```json
{
  "escrow_id": 123,
  "onchain_escrow_id": "12",
  "database_balance": "100.000000",
  "contract_stored_balance": "100.000000",
  "contract_calculated_balance": "100.000000",
  "original_amount": "100.000000",
  "state": "FUNDED"
}
```

#### 2. Contract Stored Balance
**GET** `/escrows/:onchainEscrowId/stored-balance`
- **Purpose**: Direct access to contract's internal balance tracking
- **Response**:
```json
{
  "onchain_escrow_id": "12",
  "stored_balance": "100.000000",
  "stored_balance_raw": "100000000"
}
```

#### 3. Contract Calculated Balance
**GET** `/escrows/:onchainEscrowId/calculated-balance`
- **Purpose**: Expected balance based on escrow state logic
- **Response**:
```json
{
  "onchain_escrow_id": "12",
  "calculated_balance": "100.000000",
  "calculated_balance_raw": "100000000"
}
```

#### 4. Sequential Escrow Information
**GET** `/escrows/:onchainEscrowId/sequential-info`
- **Purpose**: Information about sequential escrow transfers
- **Response**:
```json
{
  "onchain_escrow_id": "12",
  "is_sequential": true,
  "sequential_address": "0x1234...",
  "sequential_balance": "100.000000",
  "sequential_balance_raw": "100000000",
  "was_released": false
}
```

#### 5. Auto-Cancel Eligibility Check
**GET** `/escrows/:onchainEscrowId/auto-cancel-eligible`
- **Purpose**: Check if escrow can be automatically cancelled
- **Response**:
```json
{
  "onchain_escrow_id": "12",
  "is_eligible_for_auto_cancel": true
}
```

## Event Listener Updates

### EscrowBalanceChanged Event Handler
```typescript
case 'EscrowBalanceChanged': {
  const escrowId = parsed.args.escrowId.toString();
  const newBalance = parsed.args.newBalance.toString();
  const reason = parsed.args.reason as string;

  // Convert blockchain amount (with 6 decimals) to database decimal format
  const balanceInDecimal = Number(newBalance) / 1_000_000;

  await query(
    'UPDATE escrows SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2',
    [balanceInDecimal, escrowId]
  );
}
```

### Enhanced Auto-Cancellation Detection
- Improved detection logic in `EscrowCancelled` event handler
- Links auto-cancellations to monitoring service records
- Updates escrow state to `AUTO_CANCELLED` when detected

## Monitoring Service Enhancements

### Balance Validation
- Pre-cancellation balance validation using new contract functions
- Database synchronization when mismatches detected
- Audit logging of balance validation results

### Key Features
```typescript
// Balance validation before auto-cancellation
const storedBalance = await this.contract.getStoredEscrowBalance(escrowId);
const calculatedBalance = await this.contract.getCalculatedEscrowBalance(escrowId);

// Database synchronization
if (Math.abs(parseFloat(storedFormatted) - dbBalance) > 0.000001) {
  await syncEscrowBalance(escrowId.toString(), storedFormatted, 'Auto-cancel validation sync');
}
```

### Periodic Balance Validation
- Random 10% chance balance validation during monitoring cycles
- Ensures database stays in sync with contract state
- Proactive detection of balance discrepancies

## Database Layer Updates

### New Helper Functions
```typescript
// Sync escrow balance with contract data
export async function syncEscrowBalance(onchainEscrowId: string, contractBalance: string, reason?: string)

// Get escrows with potential balance mismatches
export async function getEscrowsWithBalanceMismatch()

// Record balance validation for audit
export async function recordBalanceValidation(onchainEscrowId: string, storedBalance: string, calculatedBalance: string, dbBalance: number)
```

## Utility Functions (celo.ts)

### Convenience Functions
```typescript
// Get both stored and calculated balances
const getEscrowBalance = async (escrowId: number): Promise<{stored: string, calculated: string}>

// Get sequential escrow information
const getSequentialInfo = async (escrowId: number)

// Check auto-cancel eligibility
const checkAutoCancelEligible = async (escrowId: number): Promise<boolean>
```

## Configuration

### Environment Variables
```bash
# Existing monitoring configuration
ESCROW_MONITOR_ENABLED=true
ESCROW_MONITOR_CRON_SCHEDULE=* * * * *
ESCROW_MONITOR_BATCH_SIZE=50
AUTO_CANCEL_DELAY_HOURS=1

# Network configuration
CONTRACT_ADDRESS_TESTNET=0xE68cf67df40B3d93Be6a10D0A18d0846381Cbc0E
CONTRACT_ADDRESS=0xf8C832021350133769EE5E0605a9c40c1765ace7
```

## Security & Access Control

### Authentication
- All new endpoints require JWT authentication (`requireJWT`)
- Users can only access escrows they're participating in (seller/buyer)
- Wallet address verification against JWT token

### Authorization Check Example
```typescript
const escrowResult = await query(
  `SELECT e.id FROM escrows e
   JOIN accounts a ON e.seller_address = a.wallet_address OR e.buyer_address = a.wallet_address
   WHERE e.onchain_escrow_id = $1 AND LOWER(a.wallet_address) = LOWER($2)`,
  [onchainEscrowId, jwtWalletAddress]
);
```

## Error Handling

### Graceful Degradation
- Fallback to database data if contract calls fail
- Warning messages for unavailable contract data
- Retry logic for transient network errors

### Example Error Handling
```typescript
try {
  const contractBalance = await contract.getStoredEscrowBalance(escrowId);
  // Use contract data
} catch (contractError) {
  console.warn('Contract call failed, using database data:', contractError);
  // Fallback to database data with warning
}
```

## Testing

### Test Coverage
- Network connectivity tests for both testnet and mainnet
- Balance consistency validation
- Auto-cancellation eligibility checks
- API endpoint functionality

### Test Command
```bash
npm run test:escrow-monitoring
```

## Monitoring & Observability

### Logging
- Balance validation results
- Database synchronization actions
- Auto-cancellation attempts and results
- Contract call failures and fallbacks

### Audit Trail
- All balance validations recorded in `contract_auto_cancellations` table
- Transaction hashes for successful auto-cancellations
- Error messages for failed operations

## Migration Path

### Backward Compatibility
- Existing `/escrows/:id/balance` endpoint enhanced but maintains compatibility
- New endpoints are additive, no breaking changes
- Gradual rollout with feature flags

### Database Schema
- No schema changes required
- Uses existing `escrows.current_balance` field
- Leverages existing `contract_auto_cancellations` table for audit

## Performance Considerations

### Optimization Strategies
- Batch contract calls where possible
- Database connection pooling with retry logic
- Random sampling for balance validation (10% of cycles)
- Efficient database queries with proper indexing

### Gas Optimization
- Gas estimation before auto-cancellation transactions
- 20% buffer for gas limit calculations
- Fallback handling for gas estimation failures

## Future Enhancements

### Potential Improvements
- Real-time balance monitoring via WebSocket events
- Dashboard for balance discrepancy tracking
- Automated alerting for persistent mismatches
- Extended audit reporting capabilities

### Scalability Considerations
- Horizontal scaling support for monitoring service
- Load balancing for API endpoints
- Database sharding strategies for high volume

## Troubleshooting

### Common Issues
1. **Balance Mismatches**: Check event processing and contract state
2. **Auto-Cancel Failures**: Verify gas settings and network connectivity
3. **API Timeouts**: Check contract response times and network latency
4. **Database Sync Issues**: Monitor balance validation logs

### Debug Commands
```bash
# Test network connectivity
npm run test:escrow-monitoring

# Check balance consistency
curl -H "Authorization: Bearer $JWT" \
  http://localhost:3011/escrows/12/balance

# Verify auto-cancel eligibility
curl -H "Authorization: Bearer $JWT" \
  http://localhost:3011/escrows/12/auto-cancel-eligible
```