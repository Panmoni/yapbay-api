// @ts-nocheck

const { expect } = require('chai');
const pool = require('../db').default;

describe('enforce_trade_deadlines trigger', () => {
  let client;

  before(async () => {
    client = await pool.connect();
  });

  beforeEach(async () => {
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  after(async () => {
    await client.release();
  });

  it('blocks leg1_state update when leg1_escrow_deposit_deadline has passed', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const res = await client.query(
      `INSERT INTO trades(
         overall_status, from_fiat_currency, destination_fiat_currency,
         leg1_state, leg1_crypto_amount, leg1_fiat_currency,
         leg1_escrow_deposit_deadline
       ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ['IN_PROGRESS', 'USD', 'USD', 'CREATED', 1.0, 'USD', past]
    );
    const id = res.rows[0].id;
    let blocked = false;
    try {
      await client.query('UPDATE trades SET leg1_state = $1 WHERE id = $2', ['FUNDED', id]);
    } catch (err) {
      blocked = true;
      expect(err.message).to.match(/Leg1 escrow deposit deadline/);
    }
    if (!blocked) throw new Error('Trigger did not block overdue leg1_state update');
  });
});
