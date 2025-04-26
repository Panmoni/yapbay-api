// @ts-nocheck

const { expect } = require('chai');
const pool = require('../db').default;
const { expireDeadlines } = require('../services/deadlineService');
const sinon = require('sinon');

describe('enforce_trade_deadlines trigger', () => {
  let client;
  let consoleLogStub;

  before(async () => {
    client = await pool.connect();
    // Stub console.log to avoid cluttering test output
    consoleLogStub = sinon.stub(console, 'log');
  });

  beforeEach(async () => {
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    consoleLogStub.reset();
  });

  after(async () => {
    await client.release();
    consoleLogStub.restore();
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

  it('auto-cancels a trade with expired deadline in CREATED state', async () => {
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
    
    // Run the expireDeadlines function
    await expireDeadlines();
    
    // Check if the trade was cancelled
    const result = await client.query('SELECT overall_status, leg1_state FROM trades WHERE id = $1', [id]);
    expect(result.rows[0].overall_status).to.equal('CANCELLED');
    expect(result.rows[0].leg1_state).to.equal('CANCELLED');
  });

  it('does not auto-cancel a trade in FIAT_PAID state despite expired deadline', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const res = await client.query(
      `INSERT INTO trades(
         overall_status, from_fiat_currency, destination_fiat_currency,
         leg1_state, leg1_crypto_amount, leg1_fiat_currency,
         leg1_fiat_payment_deadline
       ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ['IN_PROGRESS', 'USD', 'USD', 'FIAT_PAID', 1.0, 'USD', past]
    );
    const id = res.rows[0].id;
    
    // Run the expireDeadlines function
    await expireDeadlines();
    
    // Check that the trade was NOT cancelled
    const result = await client.query('SELECT overall_status, leg1_state FROM trades WHERE id = $1', [id]);
    expect(result.rows[0].overall_status).to.equal('IN_PROGRESS');
    expect(result.rows[0].leg1_state).to.equal('FIAT_PAID');
    
    // Verify that the log message about skipping was called
    expect(consoleLogStub.calledWithMatch(/Skipping trade.*FIAT_PAID/)).to.be.true;
  });
});
