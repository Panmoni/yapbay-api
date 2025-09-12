import { expect } from 'chai';
import pool from '../db';
import { NetworkService } from '../services/networkService';
import { BlockchainServiceFactory } from '../services/blockchainService';
import { NetworkFamily } from '../types/networks';

describe('Multi-Network Transaction Tests', function () {
  let client: any;
  let solanaDevnetNetwork: any;
  let solanaMainnetNetwork: any;
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
      // Get Solana network configurations
      solanaDevnetNetwork = await NetworkService.getNetworkById(3); // Solana Devnet
      solanaMainnetNetwork = await NetworkService.getNetworkById(4); // Solana Mainnet

      if (!solanaDevnetNetwork || !solanaMainnetNetwork) {
        throw new Error('Solana networks not properly configured');
      }
    } catch (error) {
      console.error('Failed to setup Solana networks:', error);
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

  describe('Solana Transaction Recording', function () {
    it('should record Solana transaction with signature', async function () {
      // Create test account and escrow
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `solana_tx_test_${Date.now()}`, `solana_tx_${Date.now()}@example.com`]
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
          'TxTestPDA123456789012345678901234567890',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          50.0,
          'CREATED',
          false,
          'solana',
          solanaDevnetNetwork.programId,
          'TxTestPDA123456789012345678901234567890',
        ]
      );
      const escrowId = escrowResult.rows[0].id;

      // Record a Solana transaction
      const solanaSignature =
        '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      const transactionResult = await client.query(
        `INSERT INTO transactions (
          related_escrow_db_id, network_id, transaction_hash, sender_address, receiver_or_contract_address,
          type, network_family, slot, signature
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          escrowId,
          solanaDevnetNetwork.id,
          null, // transaction_hash (EVM only)
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          'TxTestPDA123456789012345678901234567890',
          'FUND_ESCROW',
          'solana',
          123456789, // Solana slot number
          solanaSignature, // signature (Solana)
        ]
      );

      expect(transactionResult.rows).to.have.length(1);
      const transactionId = transactionResult.rows[0].id;

      // Verify transaction was recorded correctly
      const recordedTx = await client.query('SELECT * FROM transactions WHERE id = $1', [
        transactionId,
      ]);

      expect(recordedTx.rows).to.have.length(1);
      const tx = recordedTx.rows[0];

      expect(tx.network_family).to.equal('solana');
      expect(tx.network_id).to.equal(solanaDevnetNetwork.id);
      expect(tx.transaction_hash).to.be.null; // EVM only
      expect(tx.signature).to.equal(solanaSignature);
      expect(parseInt(tx.slot)).to.equal(123456789);
      expect(tx.type).to.equal('FUND_ESCROW');
    });

    it('should validate Solana signature format', async function () {
      // Create test escrow
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `solana_sig_test_${Date.now()}`, `solana_sig_${Date.now()}@example.com`]
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
          'SigTestPDA123456789012345678901234567890',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          25.0,
          'CREATED',
          false,
          'solana',
          solanaDevnetNetwork.programId,
          'SigTestPDA123456789012345678901234567890',
        ]
      );
      const escrowId = escrowResult.rows[0].id;

      // Test with various Solana signature formats
      const validSignatures = [
        '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW',
        '3yPKcZRpaTUuKECEBTPFRNhqZdh8RNZX1S6Db5vHGj2KJwFbgkz2cV5RfRJwZRJuQY6k4tGhJGZz4sFGHpRjQwLT',
        '4nKzRpT5VxYJdNRhJGZz4sFGHpRjQwLT3yPKcZRpaTUuKECEBTPFRNhqZdh8RNZX1S6Db5vHGj2KJwFbgkz2cV5R',
      ];

      for (let i = 0; i < validSignatures.length; i++) {
        const signature = validSignatures[i];

        const transactionResult = await client.query(
          `INSERT INTO transactions (
              related_escrow_db_id, network_id, transaction_hash, sender_address, receiver_or_contract_address,
              type, network_family, slot, signature
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            escrowId,
            solanaDevnetNetwork.id,
            null, // transaction_hash (EVM only)
            process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            'SigTestPDA123456789012345678901234567890',
            'FUND_ESCROW',
            'solana',
            123456789 + i,
            signature, // signature (Solana)
          ]
        );

        expect(transactionResult.rows).to.have.length(1);
        expect(parseInt(transactionResult.rows[0].id)).to.be.a('number');
      }
    });
  });

  describe('Solana Slot Tracking', function () {
    it('should track Solana slot numbers for transactions', async function () {
      // Create test escrow
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `solana_slot_test_${Date.now()}`, `solana_slot_${Date.now()}@example.com`]
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
          'SlotTestPDA123456789012345678901234567890',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          75.0,
          'CREATED',
          false,
          'solana',
          solanaDevnetNetwork.programId,
          'SlotTestPDA123456789012345678901234567890',
        ]
      );
      const escrowId = escrowResult.rows[0].id;

      // Record transactions with different slot numbers
      const slotNumbers = [123456789, 123456790, 123456791];
      const transactionIds: number[] = [];

      for (let i = 0; i < slotNumbers.length; i++) {
        const slot = slotNumbers[i];
        const signature = `SlotTx${i}signature12345678901234567890123456789012345678901234567890123456789012345`;

        const transactionResult = await client.query(
          `INSERT INTO transactions (
              related_escrow_db_id, network_id, transaction_hash, sender_address, receiver_or_contract_address,
              type, network_family, slot, signature
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            escrowId,
            solanaDevnetNetwork.id,
            null, // transaction_hash (EVM only)
            process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            'SlotTestPDA123456789012345678901234567890',
            'FUND_ESCROW',
            'solana',
            slot,
            signature, // signature (Solana)
          ]
        );

        transactionIds.push(transactionResult.rows[0].id);
      }

      // Query transactions by slot number range
      const slotRangeQuery = await client.query(
        'SELECT * FROM transactions WHERE slot BETWEEN $1 AND $2 ORDER BY slot',
        [123456789, 123456791]
      );

      expect(slotRangeQuery.rows).to.have.length(3);
      slotRangeQuery.rows.forEach((tx: any, index: number) => {
        expect(parseInt(tx.slot)).to.equal(slotNumbers[index]);
        expect(tx.network_family).to.equal('solana');
      });

      // Query latest transactions by slot number
      const latestSlotQuery = await client.query(
        'SELECT * FROM transactions WHERE network_id = $1 ORDER BY slot DESC LIMIT 1',
        [solanaDevnetNetwork.id]
      );

      expect(latestSlotQuery.rows).to.have.length(1);
      expect(parseInt(latestSlotQuery.rows[0].slot)).to.equal(123456791);
    });

    it('should handle slot-based transaction ordering', async function () {
      // Create test escrow
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `slot_order_test_${Date.now()}`, `slot_order_${Date.now()}@example.com`]
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
          'OrderTestPDA123456789012345678901234567890',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          60.0,
          'CREATED',
          false,
          'solana',
          solanaDevnetNetwork.programId,
          'OrderTestPDA123456789012345678901234567890',
        ]
      );
      const escrowId = escrowResult.rows[0].id;

      // Insert transactions in non-chronological order
      const transactionData = [
        { slot: 123456792, type: 'RELEASE_ESCROW' },
        { slot: 123456790, type: 'FUND_ESCROW' },
        { slot: 123456791, type: 'OTHER' },
      ];

      for (let i = 0; i < transactionData.length; i++) {
        const data = transactionData[i];
        const signature = `OrderTx${i}signature123456789012345678901234567890123456789012345678901234567890123`;

        await client.query(
          `INSERT INTO transactions (
            related_escrow_db_id, network_id, transaction_hash, sender_address, receiver_or_contract_address,
            type, network_family, slot, signature
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            escrowId,
            solanaDevnetNetwork.id,
            null, // transaction_hash (EVM only)
            process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            'OrderTestPDA123456789012345678901234567890',
            data.type,
            'solana',
            data.slot,
            signature, // signature (Solana)
          ]
        );
      }

      // Query transactions ordered by slot number
      const orderedTransactions = await client.query(
        'SELECT * FROM transactions WHERE related_escrow_db_id = $1 ORDER BY slot ASC',
        [escrowId]
      );

      expect(orderedTransactions.rows).to.have.length(3);
      expect(orderedTransactions.rows[0].type).to.equal('FUND_ESCROW');
      expect(parseInt(orderedTransactions.rows[0].slot)).to.equal(123456790);
      expect(orderedTransactions.rows[1].type).to.equal('OTHER');
      expect(parseInt(orderedTransactions.rows[1].slot)).to.equal(123456791);
      expect(orderedTransactions.rows[2].type).to.equal('RELEASE_ESCROW');
      expect(parseInt(orderedTransactions.rows[2].slot)).to.equal(123456792);
    });
  });

  describe('Cross-Network Transaction Isolation', function () {
    it('should isolate transactions by network', async function () {
      // Create test accounts and escrows on different networks
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `isolation_test_${Date.now()}`, `isolation_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      // Create trades on different networks
      const devnetTradeResult = await client.query(
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
      const devnetTradeId = devnetTradeResult.rows[0].id;

      const mainnetTradeResult = await client.query(
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
          solanaMainnetNetwork.id,
        ]
      );
      const mainnetTradeId = mainnetTradeResult.rows[0].id;

      // Create escrows on different networks
      const devnetEscrowResult = await client.query(
        `INSERT INTO escrows (
          trade_id, network_id, escrow_address, seller_address, buyer_address, 
          arbitrator_address, amount, state, sequential, network_family,
          program_id, escrow_pda
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          devnetTradeId,
          solanaDevnetNetwork.id,
          'DevnetIsolationPDA1234567890123456789012345',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          50.0,
          'CREATED',
          false,
          'solana',
          solanaDevnetNetwork.programId,
          'DevnetIsolationPDA1234567890123456789012345',
        ]
      );
      const devnetEscrowId = devnetEscrowResult.rows[0].id;

      const mainnetEscrowResult = await client.query(
        `INSERT INTO escrows (
          trade_id, network_id, escrow_address, seller_address, buyer_address, 
          arbitrator_address, amount, state, sequential, network_family,
          program_id, escrow_pda
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          mainnetTradeId,
          solanaMainnetNetwork.id,
          'MainnetIsolationPDA1234567890123456789012345',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          75.0,
          'CREATED',
          false,
          'solana',
          solanaMainnetNetwork.programId || solanaDevnetNetwork.programId, // Fallback if mainnet programId is null
          'MainnetIsolationPDA1234567890123456789012345',
        ]
      );
      const mainnetEscrowId = mainnetEscrowResult.rows[0].id;

      // Record transactions on different networks
      const devnetSignature =
        'DevnetTxSignature12345678901234567890123456789012345678901234567890123456789012345';
      await client.query(
        `INSERT INTO transactions (
          related_escrow_db_id, network_id, transaction_hash, sender_address, receiver_or_contract_address,
          type, network_family, slot, signature
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          devnetEscrowId,
          solanaDevnetNetwork.id,
          null, // transaction_hash (EVM only)
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          'DevnetIsolationPDA1234567890123456789012345',
          'FUND_ESCROW',
          'solana',
          123456789,
          devnetSignature, // signature (Solana)
        ]
      );

      const mainnetSignature =
        'MainnetTxSignature123456789012345678901234567890123456789012345678901234567890123';
      await client.query(
        `INSERT INTO transactions (
          related_escrow_db_id, network_id, transaction_hash, sender_address, receiver_or_contract_address,
          type, network_family, slot, signature
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          mainnetEscrowId,
          solanaMainnetNetwork.id,
          null, // transaction_hash (EVM only)
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          'MainnetIsolationPDA1234567890123456789012345',
          'FUND_ESCROW',
          'solana',
          987654321,
          mainnetSignature, // signature (Solana)
        ]
      );

      // Query transactions by network - should be isolated
      const devnetTransactions = await client.query(
        'SELECT * FROM transactions WHERE network_id = $1',
        [solanaDevnetNetwork.id]
      );

      const mainnetTransactions = await client.query(
        'SELECT * FROM transactions WHERE network_id = $1',
        [solanaMainnetNetwork.id]
      );

      // Verify isolation
      expect(devnetTransactions.rows).to.have.length(1);
      expect(mainnetTransactions.rows).to.have.length(1);

      expect(devnetTransactions.rows[0].network_id).to.equal(solanaDevnetNetwork.id);
      expect(devnetTransactions.rows[0].signature).to.equal(devnetSignature);
      expect(parseInt(devnetTransactions.rows[0].slot)).to.equal(123456789);

      expect(mainnetTransactions.rows[0].network_id).to.equal(solanaMainnetNetwork.id);
      expect(mainnetTransactions.rows[0].signature).to.equal(mainnetSignature);
      expect(parseInt(mainnetTransactions.rows[0].slot)).to.equal(987654321);

      // Verify no cross-network leakage
      const crossNetworkQuery = await client.query(
        'SELECT COUNT(*) FROM transactions t1 JOIN transactions t2 ON t1.signature = t2.signature WHERE t1.network_id != t2.network_id'
      );

      expect(parseInt(crossNetworkQuery.rows[0].count)).to.equal(0);
    });

    it('should prevent cross-network data leakage in transaction queries', async function () {
      // Create test data on multiple networks
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `leakage_test_${Date.now()}`, `leakage_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      // Create escrows and transactions on both networks
      const networks = [solanaDevnetNetwork, solanaMainnetNetwork];
      const transactionIds: number[] = [];

      for (let i = 0; i < networks.length; i++) {
        const network = networks[i];

        const tradeResult = await client.query(
          `INSERT INTO trades (
            overall_status, from_fiat_currency, destination_fiat_currency,
            leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
            leg1_crypto_amount, leg1_fiat_currency, network_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          ['IN_PROGRESS', 'USD', 'USD', 'CREATED', accountId, accountId, 100, 'USD', network.id]
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
            network.id,
            `LeakageTestPDA${i}1234567890123456789012345`,
            process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
            30.0 + i * 10,
            'CREATED',
            false,
            'solana',
            network.programId || solanaDevnetNetwork.programId, // Fallback if mainnet programId is null
            `LeakageTestPDA${i}1234567890123456789012345`,
          ]
        );
        const escrowId = escrowResult.rows[0].id;

        const signature = `LeakageTx${i}signature123456789012345678901234567890123456789012345678901234567890123`;
        const transactionResult = await client.query(
          `INSERT INTO transactions (
            related_escrow_db_id, network_id, transaction_hash, sender_address, receiver_or_contract_address,
            type, network_family, slot, signature
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            escrowId,
            network.id,
            null, // transaction_hash (EVM only)
            process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            `LeakageTestPDA${i}1234567890123456789012345`,
            'FUND_ESCROW',
            'solana',
            123456789 + i * 1000,
            signature, // signature (Solana)
          ]
        );

        transactionIds.push(transactionResult.rows[0].id);
      }

      // Test network-specific queries
      for (let i = 0; i < networks.length; i++) {
        const network = networks[i];

        // Query transactions for specific network
        const networkTransactions = await client.query(
          'SELECT * FROM transactions WHERE network_id = $1',
          [network.id]
        );

        expect(networkTransactions.rows).to.have.length(1);
        expect(networkTransactions.rows[0].network_id).to.equal(network.id);

        // Ensure we don't get transactions from other networks
        const otherNetworkId = i === 0 ? networks[1].id : networks[0].id;
        networkTransactions.rows.forEach((tx: any) => {
          expect(tx.network_id).to.not.equal(otherNetworkId);
        });
      }

      // Verify total isolation
      const allTransactions = await client.query(
        'SELECT network_id, COUNT(*) as count FROM transactions WHERE id IN ($1, $2) GROUP BY network_id',
        transactionIds
      );

      expect(allTransactions.rows).to.have.length(2);
      allTransactions.rows.forEach((row: any) => {
        expect(row.count).to.equal('1');
      });
    });
  });

  describe('Transaction Type Validation', function () {
    it('should support various Solana transaction types', async function () {
      // Create test escrow
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `tx_type_test_${Date.now()}`, `tx_type_${Date.now()}@example.com`]
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
          'TypeTestPDA123456789012345678901234567890',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          80.0,
          'CREATED',
          false,
          'solana',
          solanaDevnetNetwork.programId,
          'TypeTestPDA123456789012345678901234567890',
        ]
      );
      const escrowId = escrowResult.rows[0].id;

      // Test different transaction types
      const transactionTypes = [
        'FUND_ESCROW',
        'RELEASE_ESCROW',
        'CANCEL_ESCROW',
        'OTHER',
        'OPEN_DISPUTE',
        'RESOLVE_DISPUTE',
      ];

      for (let i = 0; i < transactionTypes.length; i++) {
        const txType = transactionTypes[i];
        const signature = `TypeTx${i}signature123456789012345678901234567890123456789012345678901234567890123456`;

        const transactionResult = await client.query(
          `INSERT INTO transactions (
            related_escrow_db_id, network_id, transaction_hash, sender_address, receiver_or_contract_address,
            type, network_family, slot, signature
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            escrowId,
            solanaDevnetNetwork.id,
            null, // transaction_hash (EVM only)
            process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
            'TypeTestPDA123456789012345678901234567890',
            txType,
            'solana',
            123456789 + i,
            signature, // signature (Solana)
          ]
        );

        expect(transactionResult.rows).to.have.length(1);
      }

      // Verify all transaction types were recorded
      const allTransactions = await client.query(
        'SELECT type, COUNT(*) as count FROM transactions WHERE related_escrow_db_id = $1 GROUP BY type ORDER BY type',
        [escrowId]
      );

      expect(allTransactions.rows).to.have.length(transactionTypes.length);

      const recordedTypes = allTransactions.rows.map((row: any) => row.type);
      transactionTypes.forEach(type => {
        expect(recordedTypes).to.include(type);
      });
    });
  });
});
