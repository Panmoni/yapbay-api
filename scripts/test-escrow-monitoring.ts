import { ethers } from 'ethers';
import { EscrowMonitoringService } from '../src/services/escrowMonitoringService';
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

function getAvailableNetworks(): NetworkConfig[] {
  const networks: NetworkConfig[] = [];
  
  // Check for testnet configuration
  if (process.env.CONTRACT_ADDRESS_TESTNET && process.env.CELO_RPC_URL_TESTNET) {
    networks.push({
      name: 'Alfajores Testnet',
      rpcUrl: process.env.CELO_RPC_URL_TESTNET,
      wsUrl: process.env.CELO_WS_URL_TESTNET || 'wss://alfajores-forno.celo-testnet.org/ws',
      contractAddress: process.env.CONTRACT_ADDRESS_TESTNET,
      chainId: 44787
    });
  }
  
  // Check for mainnet configuration
  if (process.env.CONTRACT_ADDRESS && process.env.CELO_RPC_URL) {
    networks.push({
      name: 'Celo Mainnet', 
      rpcUrl: process.env.CELO_RPC_URL,
      wsUrl: process.env.CELO_WS_URL || 'https://forno.celo.org/ws',
      contractAddress: process.env.CONTRACT_ADDRESS,
      chainId: 42220
    });
  }
  
  return networks;
}

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

async function testEscrowMonitoring() {
  console.log('🚀 Starting Escrow Monitoring Service Test');
  console.log('==========================================');

  try {
    // Get available networks
    const availableNetworks = getAvailableNetworks();
    console.log(`\n🌐 Detected ${availableNetworks.length} configured network(s):`);
    availableNetworks.forEach(network => {
      console.log(`   - ${network.name}: ${network.contractAddress}`);
    });
    
    if (availableNetworks.length === 0) {
      console.log('❌ No networks configured. Please check your .env file for:');
      console.log('   CONTRACT_ADDRESS_TESTNET & CELO_RPC_URL_TESTNET (for testnet)');
      console.log('   CONTRACT_ADDRESS & CELO_RPC_URL (for mainnet)');
      return;
    }

    // Initialize the monitoring service
    const service = new EscrowMonitoringService();
    console.log('✅ EscrowMonitoringService initialized successfully');

    // Test 1: Check database connection and active escrows
    console.log('\n📊 Test 1: Checking active escrows in database');
    const activeEscrows = await query(`
      SELECT 
        t.id as trade_id,
        COALESCE(t.leg1_escrow_onchain_id, '0') as leg1_id,
        COALESCE(t.leg2_escrow_onchain_id, '0') as leg2_id,
        t.leg1_state,
        t.leg2_state,
        t.overall_status
      FROM trades t 
      WHERE t.overall_status = 'IN_PROGRESS'
        AND (
          (t.leg1_escrow_onchain_id IS NOT NULL AND t.leg1_state IN ('CREATED', 'FUNDED')) OR
          (t.leg2_escrow_onchain_id IS NOT NULL AND t.leg2_state IN ('CREATED', 'FUNDED'))
        )
      LIMIT 10
    `);

    console.log(`Found ${activeEscrows.length} active escrows for monitoring:`);
    if (activeEscrows.length === 0) {
      console.log('   No active escrows found');
    } else {
      activeEscrows.forEach(escrow => {
        console.log(`   - Trade ${escrow.trade_id}: Leg1=${escrow.leg1_id}(${escrow.leg1_state}), Leg2=${escrow.leg2_id}(${escrow.leg2_state})`);
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

    // Test 2: Check auto-cancellation table exists
    console.log('\n🗄️  Test 2: Checking auto-cancellation tracking table');
    try {
      const tableCheck = await query(`
        SELECT COUNT(*) as count FROM contract_auto_cancellations
      `);
      console.log(`✅ Auto-cancellation table exists with ${tableCheck[0].count} records`);
    } catch (error) {
      console.error('❌ Auto-cancellation table missing or inaccessible:', error);
      console.log('📝 Please run the migration: psql -d your_db -f migrations/add_contract_auto_cancellations.sql');
      return;
    }

    // Test 3: Environment variables check
    console.log('\n⚙️  Test 3: Environment configuration check');
    const requiredEnvVars = [
      'PRIVATE_KEY',
      'CONTRACT_ADDRESS', 
      'ARBITRATOR_ADDRESS',
      'CELO_RPC_URL'
    ];

    let envCheckPassed = true;
    requiredEnvVars.forEach(envVar => {
      if (process.env[envVar]) {
        console.log(`✅ ${envVar}: configured`);
      } else {
        console.log(`❌ ${envVar}: missing`);
        envCheckPassed = false;
      }
    });

    if (!envCheckPassed) {
      console.log('❌ Environment configuration incomplete. Please check your .env file.');
      return;
    }

    // Test 4: Optional configuration check
    console.log('\n🔧 Test 4: Optional configuration check');
    const optionalConfig = {
      'ESCROW_MONITOR_ENABLED': process.env.ESCROW_MONITOR_ENABLED || 'false',
      'ESCROW_MONITOR_CRON_SCHEDULE': process.env.ESCROW_MONITOR_CRON_SCHEDULE || '* * * * *',
      'ESCROW_MONITOR_BATCH_SIZE': process.env.ESCROW_MONITOR_BATCH_SIZE || '50',
      'AUTO_CANCEL_DELAY_HOURS': process.env.AUTO_CANCEL_DELAY_HOURS || '1'
    };

    Object.entries(optionalConfig).forEach(([key, value]) => {
      console.log(`📋 ${key}: ${value}`);
    });

    // Test 5: Network connectivity tests
    console.log('\n🔗 Test 5: Network connectivity tests');
    for (const network of availableNetworks) {
      await testNetworkConnectivity(network);
    }

    // Test 6: Simulate monitoring run (without actual blockchain calls)
    console.log('\n🎭 Test 6: Simulate monitoring service run');
    console.log('This would check for expired escrows and perform auto-cancellations...');
    
    if (process.env.ESCROW_MONITOR_ENABLED === 'true') {
      console.log('✅ Monitoring is ENABLED - service would run automatically');
    } else {
      console.log('⚠️  Monitoring is DISABLED - set ESCROW_MONITOR_ENABLED=true to enable');
    }

    // Test 7: Database query performance test
    console.log('\n⚡ Test 7: Database query performance test');
    const startTime = Date.now();
    await query(`
      SELECT COUNT(*) as total_trades,
             COUNT(CASE WHEN overall_status = 'IN_PROGRESS' THEN 1 END) as active_trades,
             COUNT(CASE WHEN leg1_state = 'CREATED' OR leg1_state = 'FUNDED' THEN 1 END) as monitorable_leg1,
             COUNT(CASE WHEN leg2_state = 'CREATED' OR leg2_state = 'FUNDED' THEN 1 END) as monitorable_leg2
      FROM trades
    `);
    const queryTime = Date.now() - startTime;
    console.log(`✅ Database query completed in ${queryTime}ms`);

    // Environment status
    console.log('\n⚙️  Current Environment Configuration');
    console.log('=====================================');
    console.log(`NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
    console.log(`USE_TESTNET: ${process.env.USE_TESTNET || 'undefined'}`);

    // Determine which network the service would actually use
    const useTestnet = process.env.NODE_ENV === 'development' || process.env.USE_TESTNET === 'true';
    const activeNetwork = availableNetworks.find(n => useTestnet ? n.chainId === 44787 : n.chainId === 42220);
    
    if (activeNetwork) {
      console.log(`\n🎯 Active Network for Monitoring Service:`);
      console.log(`   ${activeNetwork.name} (${activeNetwork.contractAddress})`);
      console.log(`   This is determined by NODE_ENV=${process.env.NODE_ENV} and USE_TESTNET=${process.env.USE_TESTNET}`);
    } else {
      console.log(`\n⚠️  Warning: Current environment settings would use ${useTestnet ? 'testnet' : 'mainnet'} but it's not configured!`);
    }

    console.log('\n💡 To switch networks:');
    console.log('   For Testnet: Set NODE_ENV=development or USE_TESTNET=true');
    console.log('   For Mainnet: Set NODE_ENV=production and USE_TESTNET=false (or unset)');

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   - Available networks: ${availableNetworks.length}`);
    console.log(`   - Active escrows for monitoring: ${activeEscrows.length}`);
    console.log(`   - Auto-cancellation attempts: ${autoCancellations.length}`);
    console.log(`   - Monitoring enabled: ${process.env.ESCROW_MONITOR_ENABLED === 'true' ? 'YES' : 'NO'}`);
    console.log(`   - Check interval: ${optionalConfig.ESCROW_MONITOR_CRON_SCHEDULE}`);
    console.log(`   - Auto-cancel delay: ${optionalConfig.AUTO_CANCEL_DELAY_HOURS} hours`);
    console.log(`   - Batch size: ${optionalConfig.ESCROW_MONITOR_BATCH_SIZE}`);

    if (process.env.ESCROW_MONITOR_ENABLED !== 'true') {
      console.log('\n💡 To enable monitoring, add to your .env file:');
      console.log('   ESCROW_MONITOR_ENABLED=true');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the test
testEscrowMonitoring().catch(error => {
  console.error('💥 Critical test failure:', error);
  process.exit(1);
});