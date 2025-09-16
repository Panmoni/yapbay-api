# YapBay API Startup Errors Fix Plan

## Executive Summary

This document outlines a comprehensive plan to fix the startup errors in the YapBay API. The current approach focuses on **Solana Devnet only** while **preserving all Celo/EVM code** for future re-enablement. This ensures a clean startup process while maintaining backward compatibility.

## Current State Analysis

### **Root Cause of Startup Errors**

The system is attempting to start event listeners for **Solana networks** (like `solana-devnet`), but the current `NetworkEventListener` class is **hardcoded to use EVM-specific services** (`CeloService.getWsProviderForNetwork()` and `CeloService.getContractForNetwork()`).

The `CeloService` correctly throws an error when asked to create WebSocket providers for Solana networks (line 64-67 in `celo.ts`), but the `NetworkEventListener` doesn't check the network family before attempting to use EVM-specific services.

### **Current Architecture Issues**

1. **Missing Solana Event Listener**: No Solana-specific event listener implementation exists
2. **Hardcoded EVM Dependencies**: `NetworkEventListener` assumes all networks are EVM-based
3. **No Network Family Detection**: The listener doesn't differentiate between EVM and Solana networks
4. **Incomplete Multi-Network Support**: While the infrastructure exists for multiple networks, Solana support is incomplete

## **Comprehensive Fix Plan**

### **Phase 1: Create Solana Event Listener Infrastructure**

#### **1.1 Create Solana Event Listener Service**

**New File**: `src/listener/solanaEvents.ts`

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { NetworkConfig } from '../types/networks';
import { query, recordTransaction, TransactionType } from '../db';
import fs from 'fs';
import path from 'path';

const logFilePath = path.join(process.cwd(), 'events.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function fileLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  logStream.write(line);
}

export class SolanaEventListener {
  private network: NetworkConfig;
  private connection: Connection;
  private isRunning = false;

  constructor(network: NetworkConfig) {
    this.network = network;
    this.connection = new Connection(network.rpcUrl);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`Solana event listener for ${this.network.name} is already running`);
      return;
    }

    try {
      console.log(`Starting Solana event listener for ${this.network.name}`);
      fileLog(`Starting Solana event listener for ${this.network.name}`);

      // TODO: Implement Solana program event monitoring
      // This will require:
      // 1. Setting up program account change monitoring
      // 2. Parsing Solana program logs
      // 3. Converting to our event format

      // Example implementation structure:
      // const programId = new PublicKey(this.network.programId!);
      // this.connection.onProgramAccountChange(programId, async (accountInfo) => {
      //   await this.processSolanaEvent(accountInfo);
      // });

      this.isRunning = true;
      console.log(`Solana event listener started for ${this.network.name}`);
    } catch (error) {
      console.error(`Failed to start Solana event listener for ${this.network.name}:`, error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // TODO: Implement proper cleanup
    this.isRunning = false;
    console.log(`Solana event listener stopped for ${this.network.name}`);
  }

  isListening(): boolean {
    return this.isRunning;
  }

  // TODO: Implement Solana event processing
  private async processSolanaEvent(accountInfo: any): Promise<void> {
    // Example implementation:
    // 1. Parse account data to extract event information
    // 2. Record transaction with Solana-specific fields
    // 3. Record contract event with proper Solana mapping
    // Example transaction recording:
    // await recordTransaction({
    //   network_id: this.network.id,
    //   signature: accountInfo.signature,
    //   status: 'SUCCESS',
    //   type: 'EVENT',
    //   slot: accountInfo.slot,
    //   sender_address: accountInfo.account.owner.toString(),
    //   network_family: 'solana'
    // });
    // Example contract event recording:
    // await query(`
    //   INSERT INTO contract_events
    //   (network_id, event_name, block_number, transaction_hash, log_index, args)
    //   VALUES ($1, $2, $3, $4, $5, $6)
    // `, [
    //   this.network.id,
    //   'EscrowCreated',
    //   accountInfo.slot, // Use slot as block_number for Solana
    //   accountInfo.signature, // Use signature as transaction_hash for Solana
    //   0, // log_index (Solana doesn't have log index, use 0)
    //   JSON.stringify(parsedEventArgs)
    // ]);
  }
}
```

#### **1.2 Create Solana Service**

**New File**: `src/services/solanaService.ts`

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { NetworkConfig } from '../types/networks';

export class SolanaService {
  private static connections: Map<number, Connection> = new Map();

  static async getConnectionForNetwork(networkId: number): Promise<Connection> {
    if (this.connections.has(networkId)) {
      return this.connections.get(networkId)!;
    }

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      throw new Error(`Network with ID ${networkId} not found`);
    }

    if (network.networkFamily !== 'solana') {
      throw new Error(`Connection creation not supported for ${network.networkFamily} networks`);
    }

    const connection = new Connection(network.rpcUrl);
    this.connections.set(networkId, connection);

    console.log(`Created Solana connection for ${network.name}: ${network.rpcUrl}`);
    return connection;
  }

  static clearCache(): void {
    this.connections.clear();
  }
}
```

### **Phase 2: Update Multi-Network Event Listener**

#### **2.1 Make NetworkEventListener Network-Family Aware**

**Update**: `src/listener/multiNetworkEvents.ts`

```typescript
import { NetworkEventListener as EVMNetworkEventListener } from './multiNetworkEvents';
import { SolanaEventListener } from './solanaEvents';
import { NetworkFamily } from '../types/networks';

class NetworkEventListener {
  private evmListener?: EVMNetworkEventListener;
  private solanaListener?: SolanaEventListener;
  private network: NetworkConfig;
  private isRunning = false;

  constructor(network: NetworkConfig) {
    this.network = network;

    // Create appropriate listener based on network family
    if (network.networkFamily === NetworkFamily.EVM) {
      this.evmListener = new EVMNetworkEventListener(network);
    } else if (network.networkFamily === NetworkFamily.SOLANA) {
      this.solanaListener = new SolanaEventListener(network);
    } else {
      throw new Error(`Unsupported network family: ${network.networkFamily}`);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`Event listener for ${this.network.name} is already running`);
      return;
    }

    try {
      if (this.evmListener) {
        await this.evmListener.start();
      } else if (this.solanaListener) {
        await this.solanaListener.start();
      }

      this.isRunning = true;
      console.log(
        `Event listener started for ${this.network.name} (${this.network.networkFamily})`
      );
    } catch (error) {
      console.error(`Failed to start event listener for ${this.network.name}:`, error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.evmListener) {
        await this.evmListener.stop();
      } else if (this.solanaListener) {
        await this.solanaListener.stop();
      }

      this.isRunning = false;
      console.log(`Event listener stopped for ${this.network.name}`);
    } catch (error) {
      console.error(`Error stopping event listener for ${this.network.name}:`, error);
    }
  }

  isListening(): boolean {
    return this.isRunning;
  }
}
```

#### **2.2 Update MultiNetworkEventListener for Graceful Degradation**

**Update**: `src/listener/multiNetworkEvents.ts` - `startAllListeners()` method

```typescript
async startAllListeners(): Promise<void> {
  if (this.isRunning) {
    console.log('Multi-network event listener is already running');
    return;
  }

  try {
    const activeNetworks = await NetworkService.getActiveNetworks();

    if (activeNetworks.length === 0) {
      console.log('⚠️  No active networks found - continuing without event listeners');
      return; // Don't throw error, just log and continue
    }

    console.log(`Starting event listeners for ${activeNetworks.length} networks...`);
    fileLog(`Starting event listeners for ${activeNetworks.length} networks`);

    let successCount = 0;
    let failureCount = 0;

    for (const network of activeNetworks) {
      try {
        const listener = new NetworkEventListener(network);
        await listener.start();
        this.listeners.set(network.id, listener);
        successCount++;
        console.log(`✅ Started listener for ${network.name} (${network.networkFamily})`);
      } catch (error) {
        failureCount++;
        console.error(`❌ Failed to start listener for ${network.name}:`, error);
        fileLog(`Failed to start listener for ${network.name}: ${error}`);

        // Log specific guidance based on network family
        if (network.networkFamily === 'solana') {
          console.log(`💡 Note: Solana event listeners are not yet fully implemented`);
        }
      }
    }

    this.isRunning = true;
    console.log(`Multi-network event listener started with ${successCount} active listeners (${failureCount} failed)`);
    fileLog(`Multi-network event listener started with ${successCount} active listeners (${failureCount} failed)`);

    if (failureCount > 0) {
      console.log(`⚠️  Some listeners failed to start, but API will continue running`);
    }
  } catch (error) {
    console.error('Failed to start multi-network event listener:', error);
    // Don't throw - allow API to start without event listeners
    console.log('⚠️  Continuing without event listeners - API will function without real-time blockchain monitoring');
  }
}
```

### **Phase 3: Environment Configuration**

#### **3.1 Required Environment Variables**

Based on the provided `.env` variables, ensure these are configured:

```bash
# Database
POSTGRES_URL=postgres://yapbay:PASSWORD@localhost:5432/yapbay

# Solana Configuration (Devnet Only)
SOLANA_PROGRAM_ID_DEVNET=4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x
SOLANA_ARBITRATOR_KEYPAIR=your_base58_encoded_keypair_here
SOLANA_RPC_URL_DEVNET=https://distinguished-chaotic-bird.solana-devnet.quiknode.pro/483d675967ac17c1970a9b07fdba88abe17d421e/

# Celo Configuration (Disabled but Preserved)
CELO_CONTRACT_ADDRESS_TESTNET=0xE68cf67df40B3d93Be6a10D0A18d0846381Cbc0E
CELO_CONTRACT_ADDRESS=0xf8C832021350133769EE5E0605a9c40c1765ace7
CELO_ARBITRATOR_ADDRESS=0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383
CELO_PRIVATE_KEY=0xb9daa9a777bffc9596616a7e7dd857cb7db056a57bf4e27031aa2f14bb72436e
```

#### **3.2 Database Schema Reference**

**Key Tables for Event Recording:**

**`contract_events` Table:**

```sql
CREATE TABLE contract_events (
    id SERIAL PRIMARY KEY,
    network_id INTEGER NOT NULL REFERENCES networks(id),
    event_name VARCHAR(100) NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    args JSONB NOT NULL,
    trade_id BIGINT,
    transaction_id BIGINT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT contract_events_unique_tx_log_network UNIQUE (transaction_hash, log_index, network_id),
    CONSTRAINT fk_contract_events_transaction_id FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);
```

**`transactions` Table:**

```sql
CREATE TABLE transactions (
    id BIGSERIAL PRIMARY KEY,
    network_id INTEGER NOT NULL REFERENCES networks(id),
    transaction_hash VARCHAR(66), -- EVM transaction hash
    signature VARCHAR(88), -- Solana transaction signature
    status transaction_status NOT NULL DEFAULT 'PENDING',
    type transaction_type NOT NULL,
    block_number BIGINT, -- EVM block number
    slot BIGINT, -- Solana slot number
    sender_address VARCHAR(44),
    receiver_or_contract_address VARCHAR(44),
    gas_used DECIMAL(20,0),
    error_message TEXT,
    related_trade_id INTEGER REFERENCES trades(id) ON DELETE SET NULL,
    related_escrow_db_id INTEGER REFERENCES escrows(id) ON DELETE SET NULL,
    network_family VARCHAR(10) NOT NULL DEFAULT 'evm' CHECK (network_family IN ('evm', 'solana')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**`escrows` Table (Solana-specific fields):**

```sql
CREATE TABLE escrows (
    -- ... existing fields ...

    -- Network family and Solana-specific fields
    network_family VARCHAR(10) NOT NULL DEFAULT 'evm' CHECK (network_family IN ('evm', 'solana')),
    program_id VARCHAR(44), -- Solana program ID
    escrow_pda VARCHAR(44), -- Solana PDA address
    escrow_token_account VARCHAR(44), -- Solana token account
    escrow_onchain_id VARCHAR(20), -- Solana escrow ID (u64 as string)
    trade_onchain_id VARCHAR(20), -- Solana trade ID (u64 as string)

    -- ... rest of fields ...
);
```

**Transaction Types for Solana:**

```sql
CREATE TYPE transaction_type AS ENUM (
    'CREATE_ESCROW',
    'FUND_ESCROW',
    'RELEASE_ESCROW',
    'CANCEL_ESCROW',
    'MARK_FIAT_PAID',
    'OPEN_DISPUTE',
    'RESPOND_DISPUTE',
    'RESOLVE_DISPUTE',
    'EVENT',
    'INITIALIZE_BUYER_BOND',    -- Solana-specific
    'INITIALIZE_SELLER_BOND',   -- Solana-specific
    'UPDATE_SEQUENTIAL_ADDRESS', -- Solana-specific
    'AUTO_CANCEL',
    'OTHER'
);
```

#### **3.3 Solana Event Recording Guidelines**

**Key Differences for Solana Events:**

1. **Transaction Identification:**

   - Use `signature` field (VARCHAR(88)) instead of `transaction_hash`
   - Use `slot` field (BIGINT) instead of `block_number`
   - Set `network_family = 'solana'`

2. **Contract Events for Solana:**

   ```sql
   INSERT INTO contract_events (
     network_id, event_name, block_number, transaction_hash,
     log_index, args, trade_id, transaction_id
   ) VALUES (
     $1, $2, $3, $4, $5, $6, $7, $8
   );
   ```

   - For Solana: `block_number` should be `slot` number
   - For Solana: `transaction_hash` should be the Solana `signature`

3. **Transaction Recording for Solana:**

   ```sql
   INSERT INTO transactions (
     network_id, signature, status, type, slot,
     sender_address, receiver_or_contract_address,
     related_trade_id, related_escrow_db_id, network_family
   ) VALUES (
     $1, $2, $3, $4, $5, $6, $7, $8, $9, 'solana'
   );
   ```

4. **Escrow Recording for Solana:**
   ```sql
   INSERT INTO escrows (
     trade_id, network_id, escrow_address, onchain_escrow_id,
     seller_address, buyer_address, arbitrator_address,
     network_family, program_id, escrow_pda,
     escrow_token_account, escrow_onchain_id, trade_onchain_id
   ) VALUES (
     $1, $2, $3, $4, $5, $6, $7, 'solana', $8, $9, $10, $11, $12
   );
   ```

#### **3.4 Database Configuration**

Ensure the database has Solana Devnet as the only active network:

```sql
-- Disable all Celo networks (preserve for future re-enablement)
UPDATE networks SET is_active = false WHERE network_family = 'evm';

-- Ensure Solana Devnet is active
UPDATE networks SET is_active = true WHERE name = 'solana-devnet';

-- Verify configuration
SELECT name, network_family, is_active FROM networks;
```

### **Phase 4: Server Startup Updates**

#### **4.1 Update Server Startup Messages**

**Update**: `src/server.ts`

```typescript
// Start appropriate event listener based on environment
// Note: Currently focused on Solana Devnet only, Celo networks preserved for future re-enablement
if (process.env.NODE_ENV === 'development') {
  console.log('🚀 Starting multi-network event listener for development...');
  console.log('📝 Note: Currently focused on Solana Devnet only');
  console.log('📝 Note: Celo networks are preserved but disabled for future re-enablement');

  const multiListener = startMultiNetworkEventListener();
  multiListener
    .startAllListeners()
    .then(() => {
      console.log('✅ Multi-network event listener startup completed');
    })
    .catch(error => {
      console.error('❌ Event listener startup issues:', error);
      console.log('⚠️  API will continue running without real-time blockchain monitoring');
    });
} else {
  console.log('🚀 Starting single network event listener for production...');
  console.log('📝 Note: Currently focused on Solana Devnet only');
  startEventListener();
}
```

### **Phase 5: Preserve Celo Code for Future Re-enablement**

#### **5.1 Add Preservation Comments**

**Update**: `src/celo.ts` - Add header comment

```typescript
/**
 * CELO SERVICE - PRESERVED FOR FUTURE RE-ENABLEMENT
 *
 * This service is currently disabled but preserved for future use.
 * To re-enable Celo networks:
 * 1. Set Celo networks to is_active = true in database
 * 2. Ensure CELO_* environment variables are configured
 * 3. Update event listeners to handle both EVM and Solana networks
 *
 * Last updated: [Current Date]
 * Status: Disabled but functional
 */
```

#### **5.2 Add Re-enablement Documentation**

**New File**: `docs/CELO_RE_ENABLEMENT.md`

````markdown
# Celo Network Re-enablement Guide

## Overview

Celo networks have been temporarily disabled to focus on Solana Devnet implementation. This guide explains how to re-enable them in the future.

## Re-enablement Steps

1. **Update Database Configuration**
   ```sql
   UPDATE networks SET is_active = true WHERE network_family = 'evm';
   ```
````

2. **Verify Environment Variables**

   - Ensure all CELO\_\* variables are configured
   - Verify Celo RPC endpoints are accessible

3. **Test Network Connectivity**

   ```bash
   npm run test:connection
   ```

4. **Update Event Listeners**
   - Ensure both EVM and Solana listeners work together
   - Test multi-network event processing

## Preservation Status

- ✅ All Celo service code preserved
- ✅ Database schema supports both network families
- ✅ Environment variables maintained
- ✅ Tests preserved (currently disabled)

````

## **Critical Solana Implementation Patterns (From tests.ts Analysis)**

### **Key Solana Libraries and Patterns**

Based on analysis of `src/contracts/solana/tests.ts`, the correct Solana implementation patterns are:

#### **1. Keypair Loading (CRITICAL FIX)**
```typescript
import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

function loadKeypair(filePath: string): Keypair {
  const absolutePath = filePath.startsWith("~")
    ? path.join(process.env.HOME || process.env.USERPROFILE || ".", filePath.slice(1))
    : filePath;
  const secretKeyString = fs.readFileSync(absolutePath, "utf8");
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return Keypair.fromSecretKey(secretKey);
}

// Usage:
const arbitrator = loadKeypair(process.env.SOLANA_ARBITRATOR_KEYPAIR || "");
```

#### **2. Environment Variable Format**
The `.env` file should contain:
```bash
# CORRECT: JSON array format (64 bytes)
SOLANA_ARBITRATOR_KEYPAIR="[67,149,132,236,168,109,113,118,39,167,132,148,175,5,45,190,60,68,132,213,82,28,118,26,247,218,255,4,179,219,143,152,226,239,4,216,53,91,3,209,219,20,135,158,56,132,77,100,116,199,139,228,190,78,49,180,174,254,19,200,47,219,219,43]"
```

#### **3. Solana Transaction Signing**
```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, BN } from '@coral-xyz/anchor';

// Create connection
const connection = new Connection(network.rpcUrl);

// Use keypair for signing
const tx = await program.methods
  .someMethod(params)
  .accounts({
    // account mappings
  })
  .signers([arbitrator]) // Pass keypair directly
  .rpc();
```

#### **4. Program Account Operations**
```typescript
// Fetch account data
const escrowAccount = await program.account.escrow.fetch(escrowPDA);

// Get account balance
const balance = await connection.getTokenAccountBalance(tokenAccount);

// Get SOL balance
const solBalance = await connection.getBalance(publicKey);
```

### **CRITICAL FIXES NEEDED**

#### **1. EscrowMonitoringService Fix**
```typescript
// WRONG (Current):
service.arbitratorWallet = new ethers.Wallet(arbitratorPrivateKey, provider);

// CORRECT (Solana):
const arbitratorKeypair = loadKeypair(process.env.SOLANA_ARBITRATOR_KEYPAIR);
// Use keypair directly for Solana operations
```

#### **2. Solana Service Implementation**
```typescript
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';

export class SolanaService {
  private static connections: Map<number, Connection> = new Map();
  private static keypairs: Map<number, Keypair> = new Map();

  static async getConnectionForNetwork(networkId: number): Promise<Connection> {
    // Implementation similar to tests.ts
  }

  static async getArbitratorKeypair(networkId: number): Promise<Keypair> {
    // Load and cache arbitrator keypair
  }

  static async getProgramForNetwork(networkId: number): Promise<Program> {
    // Return configured Anchor program
  }
}
```

### **SECURITY IMPLICATIONS**

#### **Arbitrator Keypair Security**
The arbitrator keypair in Solana has **CRITICAL** permissions:

1. **Auto-cancellation**: Can cancel expired escrows and return funds to sellers
2. **Dispute resolution**: Can resolve disputes and distribute funds to either party
3. **Fee collection**: Receives transaction fees from all successful trades

#### **Current Security Issues**
1. **❌ Wrong keypair format**: Using JSON array instead of proper Solana format
2. **❌ Wrong library usage**: Trying to use `ethers.Wallet` with Solana
3. **❌ No keypair validation**: No verification that keypair is valid
4. **❌ Plaintext storage**: Keypair stored as plaintext in environment variables

#### **Required Security Measures**
1. **✅ Proper keypair loading**: Use `Keypair.fromSecretKey()` with correct format
2. **✅ Keypair validation**: Verify keypair can sign transactions
3. **✅ Access controls**: Limit arbitrator operations to specific functions
4. **✅ Audit logging**: Log all arbitrator actions for security monitoring
5. **🔒 Production security**: Use HSM or secure key management for production

## **Implementation Timeline**

### **Immediate (Phase 1-2)**
- ✅ Create Solana event listener infrastructure
- ✅ Update NetworkEventListener for network family detection
- ✅ Implement graceful degradation in MultiNetworkEventListener
- ❌ **CRITICAL**: Fix EscrowMonitoringService to use proper Solana keypairs

### **Short-term (Phase 3-4)**
- ✅ Update environment configuration
- ✅ Modify server startup messages
- ✅ Test startup process
- ❌ **CRITICAL**: Implement proper Solana service layer

### **Long-term (Phase 5)**
- ✅ Add preservation comments to Celo code
- ✅ Create re-enablement documentation
- ✅ Plan future multi-network support

## **Expected Outcomes**

### **Immediate Benefits**
- ✅ **Fixes startup errors** - API starts without Solana network errors
- ✅ **Clean startup process** - No more WebSocket provider errors
- ✅ **Maintains functionality** - All API endpoints work correctly
- ✅ **Preserves Celo code** - Ready for future re-enablement

### **Future Benefits**
- ✅ **Solana event monitoring** - When Solana listener is fully implemented
- ✅ **Multi-network support** - When both EVM and Solana are active
- ✅ **Flexible architecture** - Easy to add more networks

## **Testing Strategy**

### **Startup Testing**
```bash
# Test API startup
npm run start:dev

# Expected output:
# ✅ Multi-network event listener startup completed
# ✅ API running on port 3011
# ✅ No WebSocket provider errors
````

### **Functionality Testing**

```bash
# Test health check
curl http://localhost:3011/health

# Test Solana network endpoints
curl -H "X-Network-Name: solana-devnet" http://localhost:3011/offers
```

### **Database Testing**

```sql
-- Verify network configuration
SELECT name, network_family, is_active FROM networks WHERE is_active = true;
-- Should return: solana-devnet | solana | true
```

## **Rollback Plan**

If issues arise:

1. **Immediate rollback**: Revert to previous commit
2. **Database rollback**: Restore previous network configuration
3. **Environment rollback**: Use previous environment variables
4. **Service rollback**: Disable Solana, re-enable Celo if needed

## **Success Criteria**

- ✅ API starts without errors
- ✅ Solana Devnet endpoints work correctly
- ✅ Health check returns proper network status
- ✅ No WebSocket provider creation errors
- ✅ Celo code preserved and documented
- ✅ Clear path for future re-enablement

---

**This plan provides a comprehensive, step-by-step approach to fixing the startup errors while focusing on Solana Devnet and preserving Celo functionality for future use.**
