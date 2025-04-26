import pool from '../src/db';
import { expireDeadlines } from '../src/services/deadlineService';

// States where a trade should not be cancelled, regardless of deadline
const UNCANCELABLE_STATES = ['FIAT_PAID', 'RELEASED', 'DISPUTED', 'RESOLVED'];

(async () => {
  const client = await pool.connect();
  try {
    // Test 1: Test database trigger blocks updates when deadline passed
    await client.query('BEGIN');
    const past = new Date(Date.now() - 3600000).toISOString();
    const res = await client.query(
      `INSERT INTO trades(
         overall_status, from_fiat_currency, destination_fiat_currency,
         leg1_state, leg1_crypto_amount, leg1_fiat_currency,
         leg1_escrow_deposit_deadline
       ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ['IN_PROGRESS', 'USD', 'USD', 'CREATED', 1.0, 'USD', past]
    );
    const id = res.rows[0].id;
    try {
      await client.query('UPDATE trades SET leg1_state = $1 WHERE id = $2', ['FUNDED', id]);
      console.error('❌ Test 1 failed: trigger did not block update');
      await client.query('ROLLBACK');
      process.exit(1);
    } catch (err: any) {
      if (/Leg1 escrow deposit deadline/.test(err.message)) {
        console.log('✅ Test 1 passed: trigger blocked update');
        await client.query('ROLLBACK');
      } else {
        console.error('❌ Test 1 failed with unexpected error:', err);
        await client.query('ROLLBACK');
        process.exit(1);
      }
    }

    // Test 2: Test auto-cancellation respects uncancelable states
    await client.query('BEGIN');
    
    // Insert a trade with expired deadline in CREATED state (should be cancelled)
    const cancelableRes = await client.query(
      `INSERT INTO trades(
         overall_status, from_fiat_currency, destination_fiat_currency,
         leg1_state, leg1_crypto_amount, leg1_fiat_currency,
         leg1_escrow_deposit_deadline
       ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ['IN_PROGRESS', 'USD', 'USD', 'CREATED', 1.0, 'USD', past]
    );
    const cancelableId = cancelableRes.rows[0].id;
    
    // Insert a trade with expired deadline in FIAT_PAID state (should NOT be cancelled)
    const uncancelableRes = await client.query(
      `INSERT INTO trades(
         overall_status, from_fiat_currency, destination_fiat_currency,
         leg1_state, leg1_crypto_amount, leg1_fiat_currency,
         leg1_fiat_payment_deadline
       ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ['IN_PROGRESS', 'USD', 'USD', 'FIAT_PAID', 1.0, 'USD', past]
    );
    const uncancelableId = uncancelableRes.rows[0].id;
    
    // Run the expireDeadlines function
    await expireDeadlines();
    
    // Check results
    const cancelableResult = await client.query(
      'SELECT overall_status, leg1_state FROM trades WHERE id = $1',
      [cancelableId]
    );
    const uncancelableResult = await client.query(
      'SELECT overall_status, leg1_state FROM trades WHERE id = $1',
      [uncancelableId]
    );
    
    if (cancelableResult.rows[0].overall_status === 'CANCELLED' && 
        cancelableResult.rows[0].leg1_state === 'CANCELLED') {
      console.log('✅ Test 2.1 passed: Cancelable trade was auto-cancelled');
    } else {
      console.error('❌ Test 2.1 failed: Cancelable trade was not auto-cancelled');
      await client.query('ROLLBACK');
      process.exit(1);
    }
    
    if (uncancelableResult.rows[0].overall_status === 'IN_PROGRESS' && 
        uncancelableResult.rows[0].leg1_state === 'FIAT_PAID') {
      console.log('✅ Test 2.2 passed: Uncancelable trade was NOT auto-cancelled');
    } else {
      console.error('❌ Test 2.2 failed: Uncancelable trade was incorrectly auto-cancelled');
      await client.query('ROLLBACK');
      process.exit(1);
    }
    
    await client.query('ROLLBACK');
    console.log('✅ All tests passed!');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Test script error:', err);
    await client.query('ROLLBACK');
    process.exit(1);
  } finally {
    client.release();
  }
})();
