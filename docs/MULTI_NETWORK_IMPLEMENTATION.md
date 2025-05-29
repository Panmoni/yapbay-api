# Multi-Network Implementation Guide

## Overview

This guide outlines the implementation of multi-network support for YapBay API, enabling support for both Celo Alfajores testnet and Celo Mainnet with the ability to add more networks in the future.

## Architecture

### Network Specification Method: Headers
We use the `X-Network-Name` header to specify which network to use for each request:
- `X-Network-Name: celo-alfajores` for testnet
- `X-Network-Name: celo-mainnet` for mainnet

### Key Components

1. **Database Schema**: Network configuration table and network_id foreign keys
2. **Network Service**: Centralized network management and caching
3. **Middleware**: Request-level network context and validation
4. **Enhanced Celo Service**: Network-aware blockchain interactions
5. **Updated Routes**: Network-filtered data access

## Database Changes

### Migration: `20250131000000_add_multi_network_support.sql`

Creates:
- `network_type` enum with supported networks
- `networks` table for network configuration
- `network_id` columns on all relevant tables
- Indexes for efficient network-based filtering
- Updated unique constraints to include network context

### Tables with Network Context

**Network-specific tables** (have `network_id`):
- offers, trades, escrows, transactions
- contract_events, contract_auto_cancellations
- disputes, dispute_evidence, dispute_resolutions
- trade_cancellations, escrow_id_mapping

**Network-agnostic tables** (no `network_id`):
- accounts (users are cross-network)
- schema_migrations (system metadata)

## Code Implementation

### 1. Network Types and Interfaces

```typescript
// src/types/networks.ts
export enum NetworkType {
  CELO_ALFAJORES = 'celo-alfajores',
  CELO_MAINNET = 'celo-mainnet'
}

export interface NetworkConfig {
  id: number;
  name: NetworkType;
  chainId: number;
  rpcUrl: string;
  wsUrl?: string;
  contractAddress: string;
  isTestnet: boolean;
  isActive: boolean;
}
```

### 2. Network Service

```typescript
// src/services/networkService.ts
export class NetworkService {
  static async getNetworkById(id: number): Promise<NetworkConfig | null>
  static async getNetworkByName(name: NetworkType): Promise<NetworkConfig | null>
  static async getActiveNetworks(): Promise<NetworkConfig[]>
  static async getDefaultNetwork(): Promise<NetworkConfig>
  static async getNetworkFromRequest(req: Request): Promise<NetworkConfig>
}
```

### 3. Network Middleware

```typescript
// src/middleware/networkMiddleware.ts
export async function requireNetwork(req, res, next)    // Requires network header
export async function optionalNetwork(req, res, next)   // Uses default if missing
export async function addNetworkHeaders(req, res, next) // Adds network info to response
```

### 4. Enhanced Celo Service

```typescript
// src/celo.ts - Updated
export class CeloService {
  static async getProviderForNetwork(networkId: number): Promise<ethers.JsonRpcProvider>
  static async getContractForNetwork(networkId: number): Promise<YapBayEscrow>
  static async getSignedContractForNetwork(networkId: number): Promise<YapBayEscrow>
  static async getEscrowBalance(networkId: number, escrowId: number)
}
```

## Implementation Steps

### Phase 1: Database Setup
1. Run migration: `20250131000000_add_multi_network_support.sql`
2. Verify network configurations are populated
3. Test database queries with network filtering

### Phase 2: Core Services
1. Implement `NetworkService` with caching
2. Update `CeloService` for multi-network support
3. Create network middleware functions

### Phase 3: Route Updates
1. Add middleware to routes requiring network context
2. Update database queries to include `network_id` filtering
3. Modify response formats to include network information

### Phase 4: Event Processing
1. Update event listener to handle multiple networks
2. Ensure events include `network_id` in database records
3. Test event processing isolation

### Phase 5: Services Updates
1. Update deadline service for network-specific processing
2. Update escrow monitoring service
3. Ensure all background jobs respect network boundaries

## Route Implementation Examples

### Basic Pattern
```typescript
router.get('/offers', 
  requireNetwork,           // Validates X-Network-Name header
  addNetworkHeaders,        // Adds network info to response
  async (req, res) => {
    const networkId = req.networkId;
    const offers = await query(
      'SELECT * FROM offers WHERE network_id = $1', 
      [networkId]
    );
    res.json({ network: req.network.name, offers });
  }
);
```

### Optional Network Pattern
```typescript
router.get('/health', 
  optionalNetwork,          // Uses default if no header
  async (req, res) => {
    // req.network will be set to default if none specified
    res.json({ 
      network: req.network.name,
      status: 'healthy' 
    });
  }
);
```

## Frontend Integration

### Setting Network Context
```typescript
// Set default network for all requests
apiClient.defaults.headers['X-Network-Name'] = 'celo-mainnet';

// Or per-request
const offers = await apiClient.get('/offers', {
  headers: { 'X-Network-Name': 'celo-alfajores' }
});
```

### Network Switching
```typescript
// Frontend should provide network switching UI
function switchNetwork(networkName) {
  apiClient.defaults.headers['X-Network-Name'] = networkName;
  // Refetch data for new network
}
```

## Error Handling

### Network-Related Errors
- `400`: Invalid network specified
- `404`: Network not found
- `503`: Network unavailable/inactive

### Error Response Format
```json
{
  "error": "Invalid network specified",
  "message": "Network 'invalid-network' not found",
  "validNetworks": ["celo-alfajores", "celo-mainnet"]
}
```

## Testing Strategy

### Unit Tests
- NetworkService functionality
- Middleware validation
- CeloService network routing

### Integration Tests
- End-to-end API calls with different networks
- Event processing isolation
- Database query filtering

### Network Isolation Tests
- Verify data from different networks doesn't mix
- Test network switching functionality
- Validate API filtering works correctly

## Monitoring and Observability

### Logging
- Log network context in all operations
- Track network-specific metrics
- Monitor cross-network data leakage

### Metrics
- Requests per network
- Network-specific error rates
- Performance per network

## Security Considerations

### Data Isolation
- Ensure network_id is always included in queries
- Prevent cross-network data access
- Validate network context in all operations

### Access Control
- Network-specific rate limiting if needed
- Monitor for suspicious cross-network activity
- Ensure proper network validation

## Performance Considerations

### Caching
- NetworkService implements 5-minute cache
- Provider instances cached per network
- Clear cache mechanisms for testing

### Database Optimization
- Indexes on network_id columns
- Compound indexes for common query patterns
- Efficient query patterns

## Deployment Strategy

### Zero-Downtime Migration
Since you plan to clear data and restart with fresh DB:
1. Deploy new schema
2. Update application code
3. Populate network configurations
4. Start fresh with network-aware data

### Rollback Plan
- Keep migration scripts reversible
- Maintain database backups
- Document rollback procedures

## Future Network Support

### Adding New Networks
1. Add network to `network_type` enum
2. Insert configuration in `networks` table
3. Update frontend network selection
4. Test thoroughly in isolated environment

### Network Deprecation
1. Set `is_active = false` in networks table
2. Handle gracefully in middleware
3. Migrate or archive existing data
4. Remove from frontend options

## Maintenance

### Regular Tasks
- Monitor network health
- Update RPC endpoints if needed
- Review network performance metrics
- Clean up inactive network data

### Troubleshooting
- Check network configuration
- Verify middleware is applied
- Validate database queries include network_id
- Monitor for cross-network data leakage