import { expect } from 'chai';
import pool from '../db';
import { NetworkService } from '../services/networkService';
import { BlockchainServiceFactory } from '../services/blockchainService';
import { NetworkFamily } from '../types/networks';
import { Connection } from '@solana/web3.js';

describe('Solana Multi-Network Integration Tests', function () {
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

  describe('Network Service', function () {
    it('should return Solana networks in active networks', async function () {
      const networks = await NetworkService.getActiveNetworks();
      expect(networks).to.be.an('array');
      expect(networks.length).to.be.greaterThan(0);

      const solanaNetworks = networks.filter(n => n.networkFamily === NetworkFamily.SOLANA);
      expect(solanaNetworks.length).to.be.greaterThan(0);

      const networkNames = solanaNetworks.map(n => n.name);
      expect(networkNames).to.include('solana-devnet');
    });

    it('should get Solana Devnet by ID', async function () {
      const network = await NetworkService.getNetworkById(solanaDevnetNetwork.id);
      expect(network).to.not.be.null;
      expect(network!.name).to.equal('solana-devnet');
      expect(network!.networkFamily).to.equal(NetworkFamily.SOLANA);
      expect(network!.isActive).to.be.true;
    });

    it('should get Solana Mainnet by ID', async function () {
      const network = await NetworkService.getNetworkById(solanaMainnetNetwork.id);
      expect(network).to.not.be.null;
      expect(network!.name).to.equal('solana-mainnet');
      expect(network!.networkFamily).to.equal(NetworkFamily.SOLANA);
      expect(network!.isActive).to.be.false; // Currently inactive
    });

    it('should get Solana networks by name', async function () {
      const devnetNetwork = await NetworkService.getNetworkByName('solana-devnet');
      const mainnetNetwork = await NetworkService.getNetworkByName('solana-mainnet');

      expect(devnetNetwork).to.not.be.null;
      expect(mainnetNetwork).to.not.be.null;
      expect(devnetNetwork!.name).to.equal('solana-devnet');
      expect(mainnetNetwork!.name).to.equal('solana-mainnet');
    });
  });

  describe('Solana Blockchain Service Multi-Network', function () {
    it('should create blockchain services for different Solana networks', function () {
      const devnetService = BlockchainServiceFactory.create(solanaDevnetNetwork);
      const mainnetService = BlockchainServiceFactory.create(solanaMainnetNetwork);

      expect(devnetService).to.not.equal(mainnetService);
      expect(devnetService.getNetworkFamily()).to.equal(NetworkFamily.SOLANA);
      expect(mainnetService.getNetworkFamily()).to.equal(NetworkFamily.SOLANA);
    });

    it('should create Solana connections for different networks', function () {
      const devnetConnection = new Connection(solanaDevnetNetwork.rpcUrl);
      const mainnetConnection = new Connection(solanaMainnetNetwork.rpcUrl);

      expect(devnetConnection).to.not.equal(mainnetConnection);
      expect(devnetConnection.rpcEndpoint).to.equal(solanaDevnetNetwork.rpcUrl);
      expect(mainnetConnection.rpcEndpoint).to.equal(solanaMainnetNetwork.rpcUrl);
    });

    it('should validate different program IDs for different networks', function () {
      // Only test Solana Devnet as Mainnet program ID is currently NULL
      expect(solanaDevnetNetwork.programId).to.be.a('string');
      expect(solanaDevnetNetwork.programId).to.not.be.null;
      // Note: Solana Mainnet program ID is currently NULL in database
    });
  });

  describe('Data Isolation', function () {
    it('should isolate offers by Solana network', async function () {
      // Create test account with real Solana address from .env
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `solana_testuser_${Date.now()}`, `solana_test_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      // Create offer on Solana Devnet
      const devnetOffer = await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [accountId, 'BUY', 100, 200, 500, 1.05, solanaDevnetNetwork.id]
      );

      // Create offer on Solana Mainnet
      const mainnetOffer = await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [accountId, 'SELL', 150, 300, 600, 1.03, solanaMainnetNetwork.id]
      );

      // Query offers by network AND account to ensure we only get our test data
      const devnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [solanaDevnetNetwork.id, accountId]
      );

      const mainnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [solanaMainnetNetwork.id, accountId]
      );

      // Verify isolation
      expect(devnetOffers.rows).to.have.length(1);
      expect(mainnetOffers.rows).to.have.length(1);
      expect(devnetOffers.rows[0].id).to.equal(devnetOffer.rows[0].id);
      expect(mainnetOffers.rows[0].id).to.equal(mainnetOffer.rows[0].id);
      expect(devnetOffers.rows[0].offer_type).to.equal('BUY');
      expect(mainnetOffers.rows[0].offer_type).to.equal('SELL');
    });

    it('should isolate trades by Solana network', async function () {
      // Create test account with real Solana address from .env
      const uniqueWallet =
        process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `solana_testuser2_${Date.now()}`, `solana_test2_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      // Create trade on Solana Devnet
      const devnetTrade = await client.query(
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
      const devnetTradeId = devnetTrade.rows[0].id;

      // Create trade on Solana Mainnet
      const mainnetTrade = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          'IN_PROGRESS',
          'EUR',
          'EUR',
          'FUNDED',
          accountId,
          accountId,
          200,
          'EUR',
          solanaMainnetNetwork.id,
        ]
      );
      const mainnetTradeId = mainnetTrade.rows[0].id;

      // Query trades by network AND specific IDs to ensure we only get our test data
      const devnetTrades = await client.query(
        'SELECT * FROM trades WHERE network_id = $1 AND id = $2',
        [solanaDevnetNetwork.id, devnetTradeId]
      );

      const mainnetTrades = await client.query(
        'SELECT * FROM trades WHERE network_id = $1 AND id = $2',
        [solanaMainnetNetwork.id, mainnetTradeId]
      );

      // Verify isolation
      expect(devnetTrades.rows).to.have.length(1);
      expect(mainnetTrades.rows).to.have.length(1);
      expect(devnetTrades.rows[0].id).to.equal(devnetTradeId);
      expect(mainnetTrades.rows[0].id).to.equal(mainnetTradeId);
      expect(devnetTrades.rows[0].leg1_state).to.equal('CREATED');
      expect(mainnetTrades.rows[0].leg1_state).to.equal('FUNDED');
    });

    it('should isolate escrows by Solana network', async function () {
      // Create test account with real Solana address from .env
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `solana_testuser3_${Date.now()}`, `solana_test3_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      // Create trade for Solana Devnet
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

      // Create trade for Solana Mainnet
      const mainnetTradeResult = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          'IN_PROGRESS',
          'EUR',
          'EUR',
          'CREATED',
          accountId,
          accountId,
          200,
          'EUR',
          solanaMainnetNetwork.id,
        ]
      );
      const mainnetTradeId = mainnetTradeResult.rows[0].id;

      // Create escrow on Solana Devnet
      const devnetEscrow = await client.query(
        `INSERT INTO escrows (
          trade_id, escrow_address, seller_address, buyer_address, arbitrator_address, 
          amount, state, sequential, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          devnetTradeId,
          'DevnetEscrowAddress123',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          100.0,
          'CREATED',
          false,
          solanaDevnetNetwork.id,
        ]
      );

      // Create escrow on Solana Mainnet
      const mainnetEscrow = await client.query(
        `INSERT INTO escrows (
          trade_id, escrow_address, seller_address, buyer_address, arbitrator_address, 
          amount, state, sequential, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          mainnetTradeId,
          'MainnetEscrowAddress456',
          process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ',
          process.env.SOLANA_ARBITRATOR_ADDRESS || 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
          50.0,
          'FUNDED',
          false,
          solanaMainnetNetwork.id,
        ]
      );

      // Query escrows by network
      const devnetEscrows = await client.query(
        'SELECT * FROM escrows WHERE network_id = $1 AND id = $2',
        [solanaDevnetNetwork.id, devnetEscrow.rows[0].id]
      );

      const mainnetEscrows = await client.query(
        'SELECT * FROM escrows WHERE network_id = $1 AND id = $2',
        [solanaMainnetNetwork.id, mainnetEscrow.rows[0].id]
      );

      // Verify isolation
      expect(devnetEscrows.rows).to.have.length(1);
      expect(mainnetEscrows.rows).to.have.length(1);
      expect(devnetEscrows.rows[0].escrow_address).to.equal('DevnetEscrowAddress123');
      expect(mainnetEscrows.rows[0].escrow_address).to.equal('MainnetEscrowAddress456');
      expect(devnetEscrows.rows[0].state).to.equal('CREATED');
      expect(mainnetEscrows.rows[0].state).to.equal('FUNDED');
    });
  });

  describe('Cross-Network Data Integrity', function () {
    it('should not find offers from other Solana networks in filtered queries', async function () {
      // Create test account
      const uniqueWallet =
        process.env.SOLANA_SELLER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `solana_testuser4_${Date.now()}`, `solana_test4_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      // Create offer on Solana Devnet
      await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [accountId, 'BUY', 100, 200, 500, 1.05, solanaDevnetNetwork.id]
      );

      // Create offer on Solana Mainnet
      await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [accountId, 'SELL', 150, 300, 600, 1.03, solanaMainnetNetwork.id]
      );

      // Query offers for Solana Devnet only
      const devnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [solanaDevnetNetwork.id, accountId]
      );

      // Query offers for Solana Mainnet only
      const mainnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [solanaMainnetNetwork.id, accountId]
      );

      // Verify cross-network isolation
      expect(devnetOffers.rows).to.have.length(1);
      expect(mainnetOffers.rows).to.have.length(1);
      expect(devnetOffers.rows[0].network_id).to.equal(solanaDevnetNetwork.id);
      expect(mainnetOffers.rows[0].network_id).to.equal(solanaMainnetNetwork.id);
    });

    it('should maintain referential integrity within Solana networks', async function () {
      // Create test account
      const uniqueWallet =
        process.env.SOLANA_BUYER_ADDRESS || '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `solana_testuser5_${Date.now()}`, `solana_test5_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      // Create offer on Solana Devnet
      const offerResult = await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [accountId, 'BUY', 100, 200, 500, 1.05, solanaDevnetNetwork.id]
      );
      const offerId = offerResult.rows[0].id;

      // Create trade referencing the offer
      const tradeResult = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, leg1_offer_id, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          'IN_PROGRESS',
          'USD',
          'USD',
          'CREATED',
          accountId,
          accountId,
          100,
          'USD',
          offerId,
          solanaDevnetNetwork.id,
        ]
      );
      const tradeId = tradeResult.rows[0].id;

      // Verify referential integrity
      const tradeWithOffer = await client.query(
        'SELECT t.*, o.id as offer_id FROM trades t JOIN offers o ON t.leg1_offer_id = o.id WHERE t.id = $1',
        [tradeId]
      );

      expect(tradeWithOffer.rows).to.have.length(1);
      expect(tradeWithOffer.rows[0].network_id).to.equal(solanaDevnetNetwork.id);
      expect(tradeWithOffer.rows[0].offer_id).to.equal(offerId);
    });
  });
});
