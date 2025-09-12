import { expect } from 'chai';
import pool from '../db';
import { NetworkService } from '../services/networkService';
import { BlockchainServiceFactory } from '../services/blockchainService';
import { NetworkFamily } from '../types/networks';

describe('Solana Escrow Operations Tests', function () {
  let client: any;
  let solanaDevnetNetwork: any;
  let consoleLogStub: any;

  before(async function () {
    this.timeout(10000);

    client = await pool.connect();
    consoleLogStub = {
      restore: () => {},
      reset: () => {},
    };
    const originalLog = console.log;
    console.log = () => {};
    consoleLogStub.restore = () => {
      console.log = originalLog;
    };

    try {
      // Get Solana Devnet network configuration
      solanaDevnetNetwork = await NetworkService.getNetworkById(3); // Solana Devnet

      if (!solanaDevnetNetwork) {
        throw new Error('Solana Devnet network not properly configured');
      }
    } catch (error) {
      console.error('Failed to setup Solana Devnet network:', error);
      this.skip();
    }
  });

  beforeEach(async function () {
    await client.query('BEGIN');
  });

  afterEach(async function () {
    await client.query('ROLLBACK');
    consoleLogStub.reset();
  });

  after(async function () {
    if (client) {
      await client.release();
    }
    if (consoleLogStub) {
      consoleLogStub.restore();
    }
  });

  describe('Solana Escrow Creation', function () {
    it('should create escrow with Solana-specific fields', async function () {
      // Create test account
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [
          uniqueWallet,
          `solana_escrow_test_${Date.now()}`,
          `solana_escrow_${Date.now()}@example.com`,
        ]
      );
      const accountId = accountResult.rows[0].id;

      // Create trade
      const tradeResult = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          'IN_PROGRESS',
          'USD',
          'USD',
          'CREATED',
          accountId,
          accountId,
          100,
          'USD',
          solanaDevnetNetwork.id,
        ]
      );
      const tradeId = tradeResult.rows[0].id;

      // Create Solana escrow with all Solana-specific fields
      const escrowResult = await client.query(
        `INSERT INTO escrows (
          trade_id, network_id, escrow_address, seller_address, buyer_address, 
          arbitrator_address, amount, state, sequential, network_family,
          program_id, escrow_pda, escrow_token_account, escrow_onchain_id, trade_onchain_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [
          tradeId,
          solanaDevnetNetwork.id,
          'TestEscrowPDA123456789012345678901234567890',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          50.0,
          'CREATED',
          false,
          'solana',
          solanaDevnetNetwork.programId,
          'TestEscrowPDA123456789012345678901234567890',
          'TestTokenAccount123456789012345678901234567',
          '12345',
          '67890',
        ]
      );

      const escrowId = escrowResult.rows[0].id;

      // Verify escrow was created with Solana fields
      const createdEscrow = await client.query('SELECT * FROM escrows WHERE id = $1', [escrowId]);

      expect(createdEscrow.rows).to.have.length(1);
      const escrow = createdEscrow.rows[0];

      expect(escrow.network_family).to.equal('solana');
      expect(escrow.program_id).to.equal(solanaDevnetNetwork.programId);
      expect(escrow.escrow_pda).to.equal('TestEscrowPDA123456789012345678901234567890');
      expect(escrow.escrow_token_account).to.equal('TestTokenAccount123456789012345678901234567');
      expect(escrow.escrow_onchain_id).to.equal('12345');
      expect(escrow.trade_onchain_id).to.equal('67890');
      expect(escrow.state).to.equal('CREATED');
    });

    it('should validate Solana address formats in escrow creation', async function () {
      // Create test account
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [
          uniqueWallet,
          `solana_validation_test_${Date.now()}`,
          `solana_validation_${Date.now()}@example.com`,
        ]
      );
      const accountId = accountResult.rows[0].id;

      // Create trade
      const tradeResult = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          'IN_PROGRESS',
          'USD',
          'USD',
          'CREATED',
          accountId,
          accountId,
          100,
          'USD',
          solanaDevnetNetwork.id,
        ]
      );
      const tradeId = tradeResult.rows[0].id;

      // Test with valid 44-character Solana addresses
      const validSolanaAddress = '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const validPDA = 'TestEscrowPDA123456789012345678901234567890';
      const validTokenAccount = 'TestTokenAccount123456789012345678901234567';

      const escrowResult = await client.query(
        `INSERT INTO escrows (
          trade_id, network_id, escrow_address, seller_address, buyer_address, 
          arbitrator_address, amount, state, sequential, network_family,
          program_id, escrow_pda, escrow_token_account
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          tradeId,
          solanaDevnetNetwork.id,
          validPDA,
          validSolanaAddress,
          validSolanaAddress,
          validSolanaAddress,
          25.0,
          'CREATED',
          false,
          'solana',
          solanaDevnetNetwork.programId,
          validPDA,
          validTokenAccount,
        ]
      );

      expect(escrowResult.rows).to.have.length(1);
      expect(escrowResult.rows[0].id).to.be.a('number');
    });
  });

  describe('Solana Escrow State Management', function () {
    let testEscrowId: number;

    beforeEach(async function () {
      // Create test escrow for state management tests
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `solana_state_test_${Date.now()}`, `solana_state_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      const tradeResult = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          'IN_PROGRESS',
          'USD',
          'USD',
          'CREATED',
          accountId,
          accountId,
          100,
          'USD',
          solanaDevnetNetwork.id,
        ]
      );
      const tradeId = tradeResult.rows[0].id;

      const escrowResult = await client.query(
        `INSERT INTO escrows (
          trade_id, network_id, escrow_address, seller_address, buyer_address, 
          arbitrator_address, amount, state, sequential, network_family,
          program_id, escrow_pda
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          tradeId,
          solanaDevnetNetwork.id,
          'StateTestPDA123456789012345678901234567890',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          75.0,
          'CREATED',
          false,
          'solana',
          solanaDevnetNetwork.programId,
          'StateTestPDA123456789012345678901234567890',
        ]
      );

      testEscrowId = escrowResult.rows[0].id;
    });

    it('should transition escrow from CREATED to FUNDED', async function () {
      // Update escrow state to FUNDED
      await client.query('UPDATE escrows SET state = $1, current_balance = $2 WHERE id = $3', [
        'FUNDED',
        75.0,
        testEscrowId,
      ]);

      const updatedEscrow = await client.query(
        'SELECT state, current_balance FROM escrows WHERE id = $1',
        [testEscrowId]
      );

      expect(updatedEscrow.rows[0].state).to.equal('FUNDED');
      expect(parseFloat(updatedEscrow.rows[0].current_balance)).to.equal(75.0);
    });

    it('should transition escrow from FUNDED to RELEASED', async function () {
      // First fund the escrow
      await client.query('UPDATE escrows SET state = $1, current_balance = $2 WHERE id = $3', [
        'FUNDED',
        75.0,
        testEscrowId,
      ]);

      // Then release the escrow
      await client.query(
        'UPDATE escrows SET state = $1, current_balance = $2, completed_at = NOW() WHERE id = $3',
        ['RELEASED', 0.0, testEscrowId]
      );

      const releasedEscrow = await client.query(
        'SELECT state, current_balance, completed_at FROM escrows WHERE id = $1',
        [testEscrowId]
      );

      expect(releasedEscrow.rows[0].state).to.equal('RELEASED');
      expect(parseFloat(releasedEscrow.rows[0].current_balance)).to.equal(0.0);
      expect(releasedEscrow.rows[0].completed_at).to.not.be.null;
    });

    it('should transition escrow to CANCELLED state', async function () {
      // Cancel the escrow
      await client.query('UPDATE escrows SET state = $1, completed_at = NOW() WHERE id = $2', [
        'CANCELLED',
        testEscrowId,
      ]);

      const cancelledEscrow = await client.query(
        'SELECT state, completed_at FROM escrows WHERE id = $1',
        [testEscrowId]
      );

      expect(cancelledEscrow.rows[0].state).to.equal('CANCELLED');
      expect(cancelledEscrow.rows[0].completed_at).to.not.be.null;
    });

    it('should handle DISPUTED state for Solana escrows', async function () {
      // Get the trade ID from the escrow
      const escrowData = await client.query('SELECT trade_id FROM escrows WHERE id = $1', [
        testEscrowId,
      ]);
      const tradeId = escrowData.rows[0].trade_id;

      // Create a dispute for the escrow
      const disputeResult = await client.query(
        `INSERT INTO disputes (
          trade_id, escrow_id, network_id, initiator_address, bond_amount, status
        ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          tradeId,
          testEscrowId,
          solanaDevnetNetwork.id,
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          10.0,
          'OPENED',
        ]
      );

      // Update escrow to DISPUTED state
      await client.query('UPDATE escrows SET state = $1, dispute_id = $2 WHERE id = $3', [
        'DISPUTED',
        disputeResult.rows[0].id,
        testEscrowId,
      ]);

      const disputedEscrow = await client.query(
        'SELECT state, dispute_id FROM escrows WHERE id = $1',
        [testEscrowId]
      );

      expect(disputedEscrow.rows[0].state).to.equal('DISPUTED');
      expect(disputedEscrow.rows[0].dispute_id).to.equal(disputeResult.rows[0].id);
    });
  });

  describe('Solana Escrow Monitoring', function () {
    it('should query escrows by network family', async function () {
      // Create multiple escrows on Solana network
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [
          uniqueWallet,
          `solana_monitor_test_${Date.now()}`,
          `solana_monitor_${Date.now()}@example.com`,
        ]
      );
      const accountId = accountResult.rows[0].id;

      // Create multiple trades and escrows
      for (let i = 0; i < 3; i++) {
        const tradeResult = await client.query(
          `INSERT INTO trades (
            overall_status, from_fiat_currency, destination_fiat_currency,
            leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
            leg1_crypto_amount, leg1_fiat_currency, network_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            'IN_PROGRESS',
            'USD',
            'USD',
            'CREATED',
            accountId,
            accountId,
            100 + i * 10,
            'USD',
            solanaDevnetNetwork.id,
          ]
        );
        const tradeId = tradeResult.rows[0].id;

        await client.query(
          `INSERT INTO escrows (
            trade_id, network_id, escrow_address, seller_address, buyer_address, 
            arbitrator_address, amount, state, sequential, network_family,
            program_id, escrow_pda
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            tradeId,
            solanaDevnetNetwork.id,
            `MonitorTestPDA${i}1234567890123456789012345678`,
            process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
            50.0 + i * 5,
            i === 0 ? 'CREATED' : i === 1 ? 'FUNDED' : 'RELEASED',
            false,
            'solana',
            solanaDevnetNetwork.programId,
            `MonitorTestPDA${i}1234567890123456789012345678`,
          ]
        );
      }

      // Query escrows by network family
      const solanaEscrows = await client.query(
        'SELECT * FROM escrows WHERE network_family = $1 AND network_id = $2',
        ['solana', solanaDevnetNetwork.id]
      );

      expect(solanaEscrows.rows).to.have.length(3);
      solanaEscrows.rows.forEach((escrow: any) => {
        expect(escrow.network_family).to.equal('solana');
        expect(escrow.network_id).to.equal(solanaDevnetNetwork.id);
        expect(escrow.program_id).to.equal(solanaDevnetNetwork.programId);
      });
    });

    it('should query escrows by state for monitoring', async function () {
      // Create escrows in different states
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [
          uniqueWallet,
          `solana_state_monitor_${Date.now()}`,
          `solana_state_monitor_${Date.now()}@example.com`,
        ]
      );
      const accountId = accountResult.rows[0].id;

      const states = ['CREATED', 'FUNDED', 'RELEASED'];

      for (let i = 0; i < states.length; i++) {
        const tradeResult = await client.query(
          `INSERT INTO trades (
            overall_status, from_fiat_currency, destination_fiat_currency,
            leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
            leg1_crypto_amount, leg1_fiat_currency, network_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            'IN_PROGRESS',
            'USD',
            'USD',
            'CREATED',
            accountId,
            accountId,
            100,
            'USD',
            solanaDevnetNetwork.id,
          ]
        );
        const tradeId = tradeResult.rows[0].id;

        await client.query(
          `INSERT INTO escrows (
            trade_id, network_id, escrow_address, seller_address, buyer_address, 
            arbitrator_address, amount, state, sequential, network_family,
            program_id, escrow_pda
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            tradeId,
            solanaDevnetNetwork.id,
            `StateMonitorPDA${i}1234567890123456789012345678`,
            process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
            50.0,
            states[i],
            false,
            'solana',
            solanaDevnetNetwork.programId,
            `StateMonitorPDA${i}1234567890123456789012345678`,
          ]
        );
      }

      // Query escrows by specific state
      const createdEscrows = await client.query(
        'SELECT * FROM escrows WHERE state = $1 AND network_family = $2',
        ['CREATED', 'solana']
      );

      const fundedEscrows = await client.query(
        'SELECT * FROM escrows WHERE state = $1 AND network_family = $2',
        ['FUNDED', 'solana']
      );

      const releasedEscrows = await client.query(
        'SELECT * FROM escrows WHERE state = $1 AND network_family = $2',
        ['RELEASED', 'solana']
      );

      expect(createdEscrows.rows).to.have.length(1);
      expect(fundedEscrows.rows).to.have.length(1);
      expect(releasedEscrows.rows).to.have.length(1);

      expect(createdEscrows.rows[0].state).to.equal('CREATED');
      expect(fundedEscrows.rows[0].state).to.equal('FUNDED');
      expect(releasedEscrows.rows[0].state).to.equal('RELEASED');
    });
  });

  describe('Solana Escrow Cancellation', function () {
    it('should handle auto-cancellation for Solana escrows', async function () {
      // Create test escrow
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [
          uniqueWallet,
          `solana_cancel_test_${Date.now()}`,
          `solana_cancel_${Date.now()}@example.com`,
        ]
      );
      const accountId = accountResult.rows[0].id;

      const tradeResult = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          'IN_PROGRESS',
          'USD',
          'USD',
          'CREATED',
          accountId,
          accountId,
          100,
          'USD',
          solanaDevnetNetwork.id,
        ]
      );
      const tradeId = tradeResult.rows[0].id;

      const escrowResult = await client.query(
        `INSERT INTO escrows (
          trade_id, network_id, escrow_address, seller_address, buyer_address, 
          arbitrator_address, amount, state, sequential, network_family,
          program_id, escrow_pda
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          tradeId,
          solanaDevnetNetwork.id,
          'CancelTestPDA123456789012345678901234567890',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          50.0,
          'CREATED',
          false,
          'solana',
          solanaDevnetNetwork.programId,
          'CancelTestPDA123456789012345678901234567890',
        ]
      );

      const escrowId = escrowResult.rows[0].id;

      // Simulate auto-cancellation
      await client.query('UPDATE escrows SET state = $1, completed_at = NOW() WHERE id = $2', [
        'AUTO_CANCELLED',
        escrowId,
      ]);

      // Record the auto-cancellation
      await client.query(
        `INSERT INTO contract_auto_cancellations (
          escrow_id, network_id, status, created_at
        ) VALUES ($1, $2, $3, NOW())`,
        [escrowId, solanaDevnetNetwork.id, 'SUCCESS']
      );

      const cancelledEscrow = await client.query(
        'SELECT state, completed_at FROM escrows WHERE id = $1',
        [escrowId]
      );

      const autoCancellation = await client.query(
        'SELECT * FROM contract_auto_cancellations WHERE escrow_id = $1',
        [escrowId]
      );

      expect(cancelledEscrow.rows[0].state).to.equal('AUTO_CANCELLED');
      expect(cancelledEscrow.rows[0].completed_at).to.not.be.null;
      expect(autoCancellation.rows).to.have.length(1);
      expect(autoCancellation.rows[0].status).to.equal('SUCCESS');
      expect(autoCancellation.rows[0].network_id).to.equal(solanaDevnetNetwork.id);
    });
  });
});
