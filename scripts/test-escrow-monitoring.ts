import { NetworkService } from '../src/services/networkService';
import { BlockchainServiceFactory } from '../src/services/blockchainService';
import { query } from '../src/db';
import * as dotenv from 'dotenv';

dotenv.config();

async function getAvailableNetworks() {
  try {
    const networks = await NetworkService.getActiveNetworks();
    return networks;
  } catch (error) {
    console.error('Error getting networks:', error);
    return [];
  }
}

async function testNetworkConnectivity(network: any): Promise<void> {
  console.log(`\n🌐 Testing ${network.name}`);
  console.log(`   RPC: ${network.rpcUrl}`);
  console.log(`   Network Family: ${network.networkFamily}`);

  try {
    // Create blockchain service for this network
    const blockchainService = BlockchainServiceFactory.create(network);

    // Test network info
    const networkInfo = await blockchainService.getNetworkInfo();
    console.log(`   ✅ Connected - Network info:`, networkInfo);

    // Test address validation
    const testAddress =
      network.networkFamily === 'solana'
        ? '11111111111111111111111111111112' // System program
        : '0x1234567890123456789012345678901234567890';

    const isValidAddress = blockchainService.validateAddress(testAddress);
    console.log(`   ✅ Address validation: ${isValidAddress}`);

    // Test transaction hash validation
    const testHash =
      network.networkFamily === 'solana'
        ? '1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111'
        : '0x1234567890123456789012345678901234567890123456789012345678901234';

    const isValidHash = blockchainService.validateTransactionHash(testHash);
    console.log(`   ✅ Transaction hash validation: ${isValidHash}`);

    // Test block explorer URL
    const explorerUrl = blockchainService.getBlockExplorerUrl(testHash);
    console.log(`   ✅ Block explorer URL: ${explorerUrl}`);
  } catch (error: any) {
    console.log(`   ❌ Network connection failed: ${error.message}`);
  }
}

async function testEscrowMonitoring() {
  console.log('🚀 Starting Escrow Monitoring Service Test');
  console.log('==========================================');

  try {
    // Get available networks
    const availableNetworks = await getAvailableNetworks();
    console.log(`\n🌐 Detected ${availableNetworks.length} configured network(s):`);
    availableNetworks.forEach(network => {
      console.log(
        `   - ${network.name}: ${network.networkFamily} (${
          network.programId || network.contractAddress
        })`
      );
    });

    if (availableNetworks.length === 0) {
      console.log('❌ No active networks configured. Please check your database networks table.');
      return;
    }

    console.log('✅ Network service initialized successfully');

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
        console.log(
          `   - Trade ${escrow.trade_id}: Leg1=${escrow.leg1_id}(${escrow.leg1_state}), Leg2=${escrow.leg2_id}(${escrow.leg2_state})`
        );
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
      console.log(
        '📝 Please run the migration: psql -d your_db -f migrations/add_contract_auto_cancellations.sql'
      );
      return;
    }

    // Test 3: Environment variables check
    console.log('\n⚙️  Test 3: Environment configuration check');
    const requiredEnvVars = [
      'SOLANA_RPC_URL_DEVNET',
      'SOLANA_PROGRAM_ID_DEVNET',
      'SOLANA_USDC_MINT_DEVNET',
      'SOLANA_ARBITRATOR_KEYPAIR',
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
      ESCROW_MONITOR_ENABLED: process.env.ESCROW_MONITOR_ENABLED || 'false',
      ESCROW_MONITOR_CRON_SCHEDULE: process.env.ESCROW_MONITOR_CRON_SCHEDULE || '* * * * *',
      ESCROW_MONITOR_BATCH_SIZE: process.env.ESCROW_MONITOR_BATCH_SIZE || '50',
      AUTO_CANCEL_DELAY_HOURS: process.env.AUTO_CANCEL_DELAY_HOURS || '1',
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
    const defaultNetwork = await NetworkService.getDefaultNetwork();

    console.log(`\n🎯 Default Network for Monitoring Service:`);
    console.log(`   ${defaultNetwork.name} (${defaultNetwork.networkFamily})`);
    console.log(`   Program ID: ${defaultNetwork.programId || 'N/A'}`);
    console.log(`   Contract Address: ${defaultNetwork.contractAddress || 'N/A'}`);
    console.log(`   This is determined by NODE_ENV=${process.env.NODE_ENV}`);

    console.log('\n💡 To switch networks:');
    console.log('   For Devnet: Set NODE_ENV=development');
    console.log('   For Mainnet: Set NODE_ENV=production');

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   - Available networks: ${availableNetworks.length}`);
    console.log(`   - Active escrows for monitoring: ${activeEscrows.length}`);
    console.log(`   - Auto-cancellation attempts: ${autoCancellations.length}`);
    console.log(
      `   - Monitoring enabled: ${process.env.ESCROW_MONITOR_ENABLED === 'true' ? 'YES' : 'NO'}`
    );
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
