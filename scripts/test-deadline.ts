import pool from '../src/db';

(async () => {
  const client = await pool.connect();
  try {
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
      console.error('❌ Test failed: trigger did not block update');
      await client.query('ROLLBACK');
      process.exit(1);
    } catch (err: any) {
      if (/Leg1 escrow deposit deadline/.test(err.message)) {
        console.log('✅ Test passed: trigger blocked update');
        await client.query('ROLLBACK');
        process.exit(0);
      } else {
        console.error('❌ Test failed with unexpected error:', err);
        await client.query('ROLLBACK');
        process.exit(1);
      }
    }
  } catch (err: any) {
    console.error('❌ Test script error:', err);
    process.exit(1);
  } finally {
    client.release();
  }
})();
