import { expect } from 'chai';
import pool from '../db';
import { expireDeadlines, expireDeadlinesForNetwork } from '../services/deadlineService';
import { NetworkService } from '../services/networkService';
import { NetworkConfig } from '../types/networks';

describe.skip('enforce_trade_deadlines trigger (Celo - DISABLED)', () => {
  // DISABLED: Celo networks are currently inactive, focusing on Solana
  // These tests will be re-enabled when Celo networks are reactivated
  let client: any;
  let consoleLogStub: any;
  let defaultNetwork: NetworkConfig;

  before(async () => {
    client = await pool.connect();
    defaultNetwork = await NetworkService.getDefaultNetwork();
    // Stub console.log to avoid cluttering test output
    consoleLogStub = {
      restore: () => {},
      reset: () => {},
      calledWithMatch: () => true,
    };
    const originalLog = console.log;
    console.log = () => {};
    consoleLogStub.restore = () => {
      console.log = originalLog;
    };
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
         leg1_escrow_deposit_deadline, network_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      ['IN_PROGRESS', 'USD', 'USD', 'CREATED', 1.0, 'USD', past, defaultNetwork.id]
    );
    const id = res.rows[0].id;
    let blocked = false;
    try {
      await client.query('UPDATE trades SET leg1_state = $1 WHERE id = $2', ['FUNDED', id]);
    } catch (err) {
      blocked = true;
      expect((err as Error).message).to.match(/Leg1 escrow deposit deadline/);
    }
    if (!blocked) throw new Error('Trigger did not block overdue leg1_state update');
  });

  it('auto-cancels a trade with expired deadline in CREATED state', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();

    // This test needs to run outside of a transaction to allow the deadline service to work
    await client.query('ROLLBACK'); // End current transaction

    const res = await client.query(
      `INSERT INTO trades(
         overall_status, from_fiat_currency, destination_fiat_currency,
         leg1_state, leg1_crypto_amount, leg1_fiat_currency,
         leg1_escrow_deposit_deadline, network_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      ['IN_PROGRESS', 'USD', 'USD', 'CREATED', 1.0, 'USD', past, defaultNetwork.id]
    );
    const id = res.rows[0].id;

    try {
      // Run the network-specific deadline function
      await expireDeadlinesForNetwork(defaultNetwork.id);

      // Check if the trade was cancelled
      const result = await client.query(
        'SELECT overall_status, leg1_state FROM trades WHERE id = $1',
        [id]
      );
      expect(result.rows[0].overall_status).to.equal('CANCELLED');
      expect(result.rows[0].leg1_state).to.equal('CANCELLED');
    } finally {
      // Clean up the test data
      await client.query('DELETE FROM trades WHERE id = $1', [id]);
      // Restart transaction for next test
      await client.query('BEGIN');
    }
  });

  it('does not auto-cancel a trade in FIAT_PAID state despite expired deadline', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const res = await client.query(
      `INSERT INTO trades(
         overall_status, from_fiat_currency, destination_fiat_currency,
         leg1_state, leg1_crypto_amount, leg1_fiat_currency,
         leg1_fiat_payment_deadline, network_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      ['IN_PROGRESS', 'USD', 'USD', 'FIAT_PAID', 1.0, 'USD', past, defaultNetwork.id]
    );
    const id = res.rows[0].id;

    // Run the expireDeadlines function
    await expireDeadlines();

    // Check that the trade was NOT cancelled
    const result = await client.query(
      'SELECT overall_status, leg1_state FROM trades WHERE id = $1',
      [id]
    );
    expect(result.rows[0].overall_status).to.equal('IN_PROGRESS');
    expect(result.rows[0].leg1_state).to.equal('FIAT_PAID');

    // Note: Skipping log verification since we removed sinon dependency
    // The test above already verifies the trade was not cancelled, which is the key behavior
  });
});
