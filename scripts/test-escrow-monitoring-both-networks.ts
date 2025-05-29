import { ethers } from 'ethers';
import { YapBayEscrow } from '../src/types/YapBayEscrow';
import YapBayEscrowABI from '../src/contract/YapBayEscrow.json';
import { query } from '../src/db';
import * as dotenv from 'dotenv';

dotenv.config();

interface NetworkConfig {
  name: string;
  rpcUrl: string;
  wsUrl: string;
  contractAddress: string;
  chainId: number;
}

const NETWORKS: NetworkConfig[] = [
  {
    name: 'Alfajores Testnet',
    rpcUrl: process.env.CELO_RPC_URL_TESTNET || 'https://alfajores-forno.celo-testnet.org',
    wsUrl: process.env.CELO_WS_URL_TESTNET || 'wss://alfajores-forno.celo-testnet.org/ws',
    contractAddress: process.env.CONTRACT_ADDRESS_TESTNET || '0xC8BFB8a31fFbAF5c85bD97a1728aC43418B5871C',
    chainId: 44787
  },
  {
    name: 'Celo Mainnet',
    rpcUrl: process.env.CELO_RPC_URL || 'https://forno.celo.org',
    wsUrl: process.env.CELO_WS_URL || 'https://forno.celo.org/ws',
    contractAddress: process.env.CONTRACT_ADDRESS || '0x8E2749B2d3B84c7985e6F3FB2AB7A96399596095',
    chainId: 42220
  }
];

async function testNetworkConnectivity(network: NetworkConfig): Promise<void> {
  console.log(`\n🌐 Testing ${network.name}`);
  console.log(`   RPC: ${network.rpcUrl}`);
  console.log(`   Contract: ${network.contractAddress}`);
  
  try {
    // Create provider for this network
    const provider = new ethers.JsonRpcProvider(network.rpcUrl, {
      name: network.name.toLowerCase().replace(' ', '-'),
      chainId: network.chainId
    });

    // Test basic connectivity
    const blockNumber = await provider.getBlockNumber();
    console.log(`   ✅ Connected - Latest block: ${blockNumber}`);

    // Test contract connectivity
    const contract = new ethers.Contract(
      network.contractAddress,
      YapBayEscrowABI.abi,
      provider
    ) as unknown as YapBayEscrow;

    // Try to call a read-only function
    try {
      const nextEscrowId = await contract.nextEscrowId();
      console.log(`   ✅ Contract accessible - Next escrow ID: ${nextEscrowId}`);
      
      // Test the specific functions our monitoring service needs
      if (nextEscrowId > 1n) {
        const testEscrowId = 1;
        try {
          const isEligible = await contract.isEligibleForAutoCancel(testEscrowId);
          console.log(`   ✅ isEligibleForAutoCancel(${testEscrowId}): ${isEligible}`);
        } catch (error: any) {
          console.log(`   ⚠️  isEligibleForAutoCancel test failed: ${error.message}`);
        }

        try {
          const escrowInfo = await contract.getSequentialEscrowInfo(testEscrowId);
          console.log(`   ✅ getSequentialEscrowInfo(${testEscrowId}): sequential=${escrowInfo.isSequential}`);
        } catch (error: any) {
          console.log(`   ⚠️  getSequentialEscrowInfo test failed: ${error.message}`);
        }
      }
    } catch (error: any) {
      console.log(`   ❌ Contract call failed: ${error.message}`);
    }

  } catch (error: any) {
    console.log(`   ❌ Network connection failed: ${error.message}`);
  }
}

async function testDatabaseEscrows(): Promise<void> {
  console.log('\n📊 Database Escrow Analysis');
  console.log('==========================');

  try {
    // Get active escrows
    const activeEscrows = await query(`
      SELECT 
        t.id as trade_id,
        COALESCE(t.leg1_escrow_onchain_id, '0') as leg1_id,
        COALESCE(t.leg2_escrow_onchain_id, '0') as leg2_id,
        t.leg1_state,
        t.leg2_state,
        t.overall_status,
        t.created_at
      FROM trades t 
      WHERE t.overall_status = 'IN_PROGRESS'
        AND (
          (t.leg1_escrow_onchain_id IS NOT NULL AND t.leg1_state IN ('CREATED', 'FUNDED')) OR
          (t.leg2_escrow_onchain_id IS NOT NULL AND t.leg2_state IN ('CREATED', 'FUNDED'))
        )
      ORDER BY t.created_at DESC
      LIMIT 20
    `);

    console.log(`Found ${activeEscrows.length} active escrows for monitoring:`);
    
    if (activeEscrows.length === 0) {
      console.log('   No active escrows found');
    } else {
      activeEscrows.forEach(escrow => {
        console.log(`   - Trade ${escrow.trade_id}: Leg1=${escrow.leg1_id}(${escrow.leg1_state}), Leg2=${escrow.leg2_id}(${escrow.leg2_state}) - Created: ${escrow.created_at}`);
      });
    }

    // Get recent auto-cancellations
    const autoCancellations = await query(`
      SELECT 
        escrow_id,
        transaction_hash,
        status,
        created_at,
        error_message
      FROM contract_auto_cancellations 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    console.log(`\nRecent auto-cancellation attempts: ${autoCancellations.length}`);
    autoCancellations.forEach(cancel => {
      console.log(`   - Escrow ${cancel.escrow_id}: ${cancel.status} at ${cancel.created_at}`);
      if (cancel.transaction_hash) {
        console.log(`     TX: ${cancel.transaction_hash}`);
      }
      if (cancel.error_message) {
        console.log(`     Error: ${cancel.error_message}`);
      }
    });

  } catch (error: any) {
    console.error('❌ Database query failed:', error.message);
  }
}

async function testBothNetworks(): Promise<void> {
  console.log('🚀 YapBay Escrow Monitoring - Dual Network Test');
  console.log('================================================');
  
  // Test database first
  await testDatabaseEscrows();

  // Test each network
  for (const network of NETWORKS) {
    await testNetworkConnectivity(network);
  }

  // Environment status
  console.log('\n⚙️  Current Environment Configuration');
  console.log('=====================================');
  console.log(`NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
  console.log(`USE_TESTNET: ${process.env.USE_TESTNET || 'undefined'}`);
  console.log(`ESCROW_MONITOR_ENABLED: ${process.env.ESCROW_MONITOR_ENABLED || 'false'}`);
  console.log(`ESCROW_MONITOR_CRON_SCHEDULE: ${process.env.ESCROW_MONITOR_CRON_SCHEDULE || '* * * * *'}`);
  console.log(`AUTO_CANCEL_DELAY_HOURS: ${process.env.AUTO_CANCEL_DELAY_HOURS || '1'}`);

  // Determine which network the service would actually use
  const useTestnet = process.env.NODE_ENV === 'development' || process.env.USE_TESTNET === 'true';
  const activeNetwork = useTestnet ? NETWORKS[0] : NETWORKS[1];
  
  console.log(`\n🎯 Active Network for Monitoring Service:`);
  console.log(`   ${activeNetwork.name} (${activeNetwork.contractAddress})`);
  console.log(`   This is determined by NODE_ENV=${process.env.NODE_ENV} and USE_TESTNET=${process.env.USE_TESTNET}`);

  console.log('\n💡 To switch networks:');
  console.log('   For Testnet: Set NODE_ENV=development or USE_TESTNET=true');
  console.log('   For Mainnet: Set NODE_ENV=production and USE_TESTNET=false (or unset)');
  
  console.log('\n✅ Dual network connectivity test completed!');
}

// Run the test
testBothNetworks().catch(error => {
  console.error('💥 Critical test failure:', error);
  process.exit(1);
});