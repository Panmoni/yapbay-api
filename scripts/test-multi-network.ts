import pool from '../src/db';
import { NetworkService } from '../src/services/networkService';
import { expireDeadlinesForNetwork } from '../src/services/deadlineService';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

async function runTest(name: string, testFn: () => Promise<void>): Promise<TestResult> {
  try {
    await testFn();
    console.log(`✅ ${name}`);
    return { name, passed: true };
  } catch (error) {
    console.log(`❌ ${name}: ${(error as Error).message}`);
    return { name, passed: false, error: (error as Error).message };
  }
}

async function main() {
  console.log('🚀 Running Multi-Network Integration Tests...\n');
  
  const client = await pool.connect();
  const results: TestResult[] = [];
  
  try {
    // Test 1: Network Configuration
    results.push(await runTest('Network Configuration', async () => {
      const networks = await NetworkService.getActiveNetworks();
      if (networks.length < 2) throw new Error('Expected at least 2 active networks');
      
      const alfajores = await NetworkService.getNetworkByName('celo-alfajores');
      const mainnet = await NetworkService.getNetworkByName('celo-mainnet');
      
      if (!alfajores) throw new Error('Alfajores network not found');
      if (!mainnet) throw new Error('Mainnet network not found');
      if (alfajores.chainId !== 44787) throw new Error('Alfajores wrong chain ID');
      if (mainnet.chainId !== 42220) throw new Error('Mainnet wrong chain ID');
    }));

    // Test 2: Database Schema Validation
    results.push(await runTest('Database Schema', async () => {
      // Check that network_id columns exist
      const tables = ['offers', 'trades', 'escrows', 'transactions', 'contract_events'];
      
      for (const table of tables) {
        const result = await client.query(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = $1 AND column_name = 'network_id'
        `, [table]);
        
        if (result.rows.length === 0) {
          throw new Error(`network_id column missing from ${table} table`);
        }
      }
    }));

    // Test 3: Data Isolation - Offers
    results.push(await runTest('Offers Data Isolation', async () => {
      await client.query('BEGIN');
      
      try {
        const alfajores = await NetworkService.getNetworkByName('celo-alfajores');
        const mainnet = await NetworkService.getNetworkByName('celo-mainnet');
        
        // Create test account
        const accountResult = await client.query(
          'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
          ['0xTest1234567890123456789012345678901234567890', 'testuser', 'test@example.com']
        );
        const accountId = accountResult.rows[0].id;

        // Create offer on each network
        await client.query(
          'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [accountId, 'BUY', 100, 200, 500, 1.05, alfajores!.id]
        );
        
        await client.query(
          'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [accountId, 'SELL', 150, 300, 600, 1.03, mainnet!.id]
        );

        // Verify isolation
        const alfajoresOffers = await client.query('SELECT * FROM offers WHERE network_id = $1', [alfajores!.id]);
        const mainnetOffers = await client.query('SELECT * FROM offers WHERE network_id = $1', [mainnet!.id]);
        
        if (alfajoresOffers.rows.length !== 1) throw new Error('Alfajores should have 1 offer');
        if (mainnetOffers.rows.length !== 1) throw new Error('Mainnet should have 1 offer');
        if (alfajoresOffers.rows[0].offer_type !== 'BUY') throw new Error('Alfajores offer type wrong');
        if (mainnetOffers.rows[0].offer_type !== 'SELL') throw new Error('Mainnet offer type wrong');
        
      } finally {
        await client.query('ROLLBACK');
      }
    }));

    // Test 4: Data Isolation - Trades  
    results.push(await runTest('Trades Data Isolation', async () => {
      await client.query('BEGIN');
      
      try {
        const alfajores = await NetworkService.getNetworkByName('celo-alfajores');
        const mainnet = await NetworkService.getNetworkByName('celo-mainnet');
        
        // Create test account
        const accountResult = await client.query(
          'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
          ['0xTest2234567890123456789012345678901234567890', 'testuser2', 'test2@example.com']
        );
        const accountId = accountResult.rows[0].id;

        // Create trade on each network
        await client.query(
          'INSERT INTO trades (overall_status, from_fiat_currency, destination_fiat_currency, leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_amount, leg1_fiat_currency, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          ['IN_PROGRESS', 'USD', 'USD', 'CREATED', accountId, accountId, 100, 'USD', alfajores!.id]
        );
        
        await client.query(
          'INSERT INTO trades (overall_status, from_fiat_currency, destination_fiat_currency, leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_amount, leg1_fiat_currency, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          ['IN_PROGRESS', 'EUR', 'EUR', 'FUNDED', accountId, accountId, 200, 'EUR', mainnet!.id]
        );

        // Verify isolation
        const alfajoresTrades = await client.query('SELECT * FROM trades WHERE network_id = $1', [alfajores!.id]);
        const mainnetTrades = await client.query('SELECT * FROM trades WHERE network_id = $1', [mainnet!.id]);
        
        if (alfajoresTrades.rows.length !== 1) throw new Error('Alfajores should have 1 trade');
        if (mainnetTrades.rows.length !== 1) throw new Error('Mainnet should have 1 trade');
        if (alfajoresTrades.rows[0].from_fiat_currency !== 'USD') throw new Error('Alfajores currency wrong');
        if (mainnetTrades.rows[0].from_fiat_currency !== 'EUR') throw new Error('Mainnet currency wrong');
        
      } finally {
        await client.query('ROLLBACK');
      }
    }));

    // Test 5: Cross-Network Prevention
    results.push(await runTest('Cross-Network Prevention', async () => {
      await client.query('BEGIN');
      
      try {
        const alfajores = await NetworkService.getNetworkByName('celo-alfajores');
        const mainnet = await NetworkService.getNetworkByName('celo-mainnet');
        
        // Create test account
        const accountResult = await client.query(
          'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
          ['0xTest3234567890123456789012345678901234567890', 'testuser3', 'test3@example.com']
        );
        const accountId = accountResult.rows[0].id;

        // Create offer on Alfajores only
        await client.query(
          'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [accountId, 'BUY', 100, 200, 500, 1.05, alfajores!.id]
        );

        // Query for offers on Mainnet (should find none)
        const mainnetOffers = await client.query('SELECT * FROM offers WHERE network_id = $1', [mainnet!.id]);
        
        if (mainnetOffers.rows.length !== 0) {
          throw new Error('Found offers on wrong network - data leakage detected!');
        }
        
      } finally {
        await client.query('ROLLBACK');
      }
    }));

    // Test 6: Deadline Service Network Isolation
    results.push(await runTest('Deadline Service Network Isolation', async () => {
      await client.query('BEGIN');
      
      try {
        const alfajores = await NetworkService.getNetworkByName('celo-alfajores');
        const mainnet = await NetworkService.getNetworkByName('celo-mainnet');
        
        // Create test account
        const accountResult = await client.query(
          'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
          ['0xTest4234567890123456789012345678901234567890', 'deadlineuser', 'deadline@example.com']
        );
        const accountId = accountResult.rows[0].id;

        const past = new Date(Date.now() - 3600000).toISOString();

        // Create expired trade on each network
        const alfajoresTrade = await client.query(
          'INSERT INTO trades (overall_status, from_fiat_currency, destination_fiat_currency, leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_amount, leg1_fiat_currency, leg1_escrow_deposit_deadline, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
          ['IN_PROGRESS', 'USD', 'USD', 'CREATED', accountId, accountId, 100, 'USD', past, alfajores!.id]
        );

        const mainnetTrade = await client.query(
          'INSERT INTO trades (overall_status, from_fiat_currency, destination_fiat_currency, leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_amount, leg1_fiat_currency, leg1_escrow_deposit_deadline, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
          ['IN_PROGRESS', 'EUR', 'EUR', 'CREATED', accountId, accountId, 200, 'EUR', past, mainnet!.id]
        );

        // Commit so deadline service can see the trades
        await client.query('COMMIT');

        // Process deadlines for Alfajores only
        await expireDeadlinesForNetwork(alfajores!.id);

        // Start new transaction to check results
        await client.query('BEGIN');

        const alfajoresResult = await client.query(
          'SELECT overall_status, leg1_state FROM trades WHERE id = $1',
          [alfajoresTrade.rows[0].id]
        );
        
        const mainnetResult = await client.query(
          'SELECT overall_status, leg1_state FROM trades WHERE id = $1',
          [mainnetTrade.rows[0].id]
        );

        // Alfajores trade should be cancelled
        if (alfajoresResult.rows[0].overall_status !== 'CANCELLED') {
          throw new Error('Alfajores trade should be cancelled');
        }

        // Mainnet trade should still be active
        if (mainnetResult.rows[0].overall_status !== 'IN_PROGRESS') {
          throw new Error('Mainnet trade should still be active');
        }
        
      } finally {
        await client.query('ROLLBACK');
      }
    }));

    // Summary
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    
    results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      console.log(`${status} ${result.name}`);
      if (!result.passed && result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });
    
    console.log(`\n${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.log('\n🎉 All multi-network tests passed! Your implementation is working correctly.');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed. Please review the errors above.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Test runner error:', error);
    process.exit(1);
  } finally {
    await client.release();
  }
}

main().catch(console.error);