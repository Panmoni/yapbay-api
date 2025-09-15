import 'dotenv/config';
import { expect } from 'chai';
import { NetworkService } from '../services/networkService';
import { BlockchainServiceFactory } from '../services/blockchainService';
import { NetworkFamily } from '../types/networks';
import { Connection } from '@solana/web3.js';
import { Pool } from 'pg';

describe('Network Service Integration Tests', function () {
  let client: Pool;
  let allNetworks: any[];
  let solanaDevnetNetwork: any;
  let solanaMainnetNetwork: any;

  before(async function () {
    try {
      // Get database connection pool
      client = new Pool({
        connectionString: process.env.POSTGRES_URL,
      });

      // Get all networks
      allNetworks = await NetworkService.getAllNetworks();
      solanaDevnetNetwork = allNetworks.find(n => n.name === 'solana-devnet');
      solanaMainnetNetwork = allNetworks.find(n => n.name === 'solana-mainnet');

      if (!solanaDevnetNetwork || !solanaMainnetNetwork) {
        this.skip();
      }
    } catch (error) {
      console.log('Skipping network service integration tests:', error);
      this.skip();
    }
  });

  after(async function () {
    this.timeout(5000); // 5 second timeout for cleanup
    if (client) {
      try {
        await client.end();
      } catch (error) {
        console.log('Error closing database connection:', error);
      }
    }
  });

  describe('Network Service Core Functionality', function () {
    it('should return all configured networks', function () {
      expect(allNetworks).to.be.an('array');
      expect(allNetworks.length).to.be.greaterThan(0);
    });

    it('should get network by ID', async function () {
      const network = await NetworkService.getNetworkById(solanaDevnetNetwork.id);
      expect(network).to.exist;
      expect(network!.id).to.equal(solanaDevnetNetwork.id);
      expect(network!.name).to.equal('solana-devnet');
    });

    it('should get network by name', async function () {
      const network = await NetworkService.getNetworkByName('solana-devnet');
      expect(network).to.exist;
      expect(network!.name).to.equal('solana-devnet');
      expect(network!.networkFamily).to.equal(NetworkFamily.SOLANA);
    });

    it('should get networks by family', async function () {
      const solanaNetworks = await NetworkService.getNetworksByFamily(NetworkFamily.SOLANA);
      expect(solanaNetworks).to.be.an('array');
      expect(solanaNetworks.length).to.be.greaterThan(0);
      expect(solanaNetworks.every((n: any) => n.networkFamily === NetworkFamily.SOLANA)).to.be.true;
    });

    it('should get default network', async function () {
      const defaultNetwork = await NetworkService.getDefaultNetwork();
      expect(defaultNetwork).to.exist;
      expect(defaultNetwork!.networkFamily).to.equal(NetworkFamily.SOLANA);
    });

    it('should validate network configuration', function () {
      allNetworks.forEach(network => {
        expect(network).to.have.property('id');
        expect(network).to.have.property('name');
        expect(network).to.have.property('networkFamily');
        expect(network).to.have.property('rpcUrl');
        expect(network).to.have.property('isActive');
        expect(network).to.have.property('isTestnet');
      });
    });
  });

  describe('Blockchain Service Factory Integration', function () {
    it('should create Solana blockchain service for Solana networks', function () {
      const solanaService = BlockchainServiceFactory.create(solanaDevnetNetwork);
      expect(solanaService).to.exist;
      expect(solanaService.getNetworkFamily()).to.equal(NetworkFamily.SOLANA);
    });

    it('should create different services for different Solana networks', function () {
      const devnetService = BlockchainServiceFactory.create(solanaDevnetNetwork);
      const mainnetService = BlockchainServiceFactory.create(solanaMainnetNetwork);

      expect(devnetService).to.exist;
      expect(mainnetService).to.exist;
      expect(devnetService.getNetworkFamily()).to.equal(NetworkFamily.SOLANA);
      expect(mainnetService.getNetworkFamily()).to.equal(NetworkFamily.SOLANA);
    });

    it('should validate addresses using blockchain service', function () {
      const service = BlockchainServiceFactory.create(solanaDevnetNetwork);
      const validAddress = '11111111111111111111111111111112'; // Valid Solana address (System Program)
      const invalidAddress = 'invalid-address';

      expect(service.validateAddress(validAddress)).to.be.true;
      expect(service.validateAddress(invalidAddress)).to.be.false;
    });

    it('should validate transaction signatures using blockchain service', function () {
      const service = BlockchainServiceFactory.create(solanaDevnetNetwork);
      const validSignature =
        '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjJfq4MZWMbbKyggtKVEznR3W3HoqKMMyRkACdzh54smHiBJRUxDi';
      const invalidSignature = 'invalid-signature';

      expect(service.validateTransactionHash(validSignature)).to.be.true;
      expect(service.validateTransactionHash(invalidSignature)).to.be.false;
    });

    it('should generate block explorer URLs using blockchain service', function () {
      const service = BlockchainServiceFactory.create(solanaDevnetNetwork);
      const testSignature =
        '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjJfq4MZWMbbKyggtKVEznR3W3HoqKMMyRkACdzh54smHiBJRUxDi';
      const blockExplorerUrl = service.getBlockExplorerUrl(testSignature);

      expect(blockExplorerUrl).to.include('explorer.solana.com');
      expect(blockExplorerUrl).to.include('cluster=devnet');
      expect(blockExplorerUrl).to.include(testSignature);
    });

    it('should throw error for unsupported network families', function () {
      const invalidNetwork = {
        ...solanaDevnetNetwork,
        networkFamily: 'invalid-family',
      };

      expect(() => BlockchainServiceFactory.create(invalidNetwork)).to.throw(
        'Unsupported network family: invalid-family'
      );
    });
  });

  describe('Cross-Network Data Isolation', function () {
    let testAccountId: number;
    let testOfferId: number;
    let testTradeId: number;
    let testEscrowId: number;

    beforeEach(async function () {
      // Create test data for both networks
      const uniqueWallet = `test-wallet-${Date.now()}`;
      const uniqueUsername = `test-user-${Date.now()}`;
      const uniqueEmail = `test-${Date.now()}@example.com`;

      // Create account first
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, uniqueUsername, uniqueEmail]
      );
      testAccountId = accountResult.rows[0].id;

      // Create offer for Solana Devnet
      const offerResult = await client.query(
        'INSERT INTO offers (creator_account_id, network_id, offer_type, token, fiat_currency, min_amount, max_amount, total_available_amount, rate_adjustment, terms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
        [
          testAccountId,
          solanaDevnetNetwork.id,
          'SELL',
          'USDC',
          'USD',
          50.0,
          100.0,
          100.0,
          0.0,
          'Test offer for network isolation',
        ]
      );
      testOfferId = offerResult.rows[0].id;

      // Create trade for Solana Devnet
      const tradeResult = await client.query(
        'INSERT INTO trades (leg1_offer_id, network_id, overall_status, from_fiat_currency, destination_fiat_currency, leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_token, leg1_crypto_amount, leg1_fiat_amount, leg1_fiat_currency) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id',
        [
          testOfferId,
          solanaDevnetNetwork.id,
          'IN_PROGRESS',
          'USD',
          'USD',
          'CREATED',
          testAccountId,
          testAccountId,
          'USDC',
          100.0,
          100.0,
          'USD',
        ]
      );
      testTradeId = tradeResult.rows[0].id;

      // Create escrow for Solana Devnet
      const escrowResult = await client.query(
        'INSERT INTO escrows (trade_id, network_id, escrow_address, seller_address, buyer_address, arbitrator_address, token_type, amount, state, sequential, network_family, program_id, escrow_pda, escrow_token_account) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id',
        [
          testTradeId,
          solanaDevnetNetwork.id,
          '1111111111111111111111111111111111111111111',
          '2222222222222222222222222222222222222222222',
          '3333333333333333333333333333333333333333333',
          '4444444444444444444444444444444444444444444',
          'USDC',
          100.0,
          'CREATED',
          false,
          'solana',
          '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
          '5555555555555555555555555555555555555555555',
          '6666666666666666666666666666666666666666666',
        ]
      );
      testEscrowId = escrowResult.rows[0].id;
    });

    afterEach(async function () {
      // Clean up test data
      await client.query('DELETE FROM escrows WHERE id = $1', [testEscrowId]);
      await client.query('DELETE FROM trades WHERE id = $1', [testTradeId]);
      await client.query('DELETE FROM offers WHERE id = $1', [testOfferId]);
      await client.query('DELETE FROM accounts WHERE id = $1', [testAccountId]);
    });

    it('should isolate offers by network', async function () {
      // Query offers for Solana Devnet (filter by test account to avoid interference from other tests)
      const devnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [solanaDevnetNetwork.id, testAccountId]
      );

      // Query offers for Solana Mainnet (filter by test account to avoid interference from other tests)
      const mainnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [solanaMainnetNetwork.id, testAccountId]
      );

      // Verify isolation
      expect(devnetOffers.rows).to.have.length(1);
      expect(mainnetOffers.rows).to.have.length(0);
      expect(devnetOffers.rows[0].network_id).to.equal(solanaDevnetNetwork.id);
    });

    it('should isolate trades by network', async function () {
      // Query trades for Solana Devnet
      const devnetTrades = await client.query('SELECT * FROM trades WHERE network_id = $1', [
        solanaDevnetNetwork.id,
      ]);

      // Query trades for Solana Mainnet
      const mainnetTrades = await client.query('SELECT * FROM trades WHERE network_id = $1', [
        solanaMainnetNetwork.id,
      ]);

      // Verify isolation
      expect(devnetTrades.rows).to.have.length(1);
      expect(mainnetTrades.rows).to.have.length(0);
      expect(devnetTrades.rows[0].network_id).to.equal(solanaDevnetNetwork.id);
    });

    it('should isolate escrows by network', async function () {
      // Query escrows for Solana Devnet
      const devnetEscrows = await client.query('SELECT * FROM escrows WHERE network_id = $1', [
        solanaDevnetNetwork.id,
      ]);

      // Query escrows for Solana Mainnet
      const mainnetEscrows = await client.query('SELECT * FROM escrows WHERE network_id = $1', [
        solanaMainnetNetwork.id,
      ]);

      // Verify isolation
      expect(devnetEscrows.rows).to.have.length(1);
      expect(mainnetEscrows.rows).to.have.length(0);
      expect(devnetEscrows.rows[0].network_id).to.equal(solanaDevnetNetwork.id);
    });

    it('should prevent cross-network data leakage in queries', async function () {
      // Query all offers
      const allOffers = await client.query('SELECT * FROM offers');

      // Query offers by network family
      const solanaOffers = await client.query(
        'SELECT o.* FROM offers o JOIN networks n ON o.network_id = n.id WHERE n.network_family = $1',
        [NetworkFamily.SOLANA]
      );

      // Verify no cross-network leakage
      expect(
        solanaOffers.rows.every(offer => {
          const network = allNetworks.find(n => n.id === offer.network_id);
          return network && network.networkFamily === NetworkFamily.SOLANA;
        })
      ).to.be.true;
    });

    it('should maintain referential integrity within networks', async function () {
      // Verify trade references correct offer
      const tradeOfferQuery = await client.query(
        'SELECT t.*, o.network_id as offer_network_id FROM trades t JOIN offers o ON t.leg1_offer_id = o.id WHERE t.id = $1',
        [testTradeId]
      );

      expect(tradeOfferQuery.rows).to.have.length(1);
      expect(tradeOfferQuery.rows[0].network_id).to.equal(tradeOfferQuery.rows[0].offer_network_id);

      // Verify escrow references correct trade
      const escrowTradeQuery = await client.query(
        'SELECT e.*, t.network_id as trade_network_id FROM escrows e JOIN trades t ON e.trade_id = t.id WHERE e.id = $1',
        [testEscrowId]
      );

      expect(escrowTradeQuery.rows).to.have.length(1);
      expect(escrowTradeQuery.rows[0].network_id).to.equal(
        escrowTradeQuery.rows[0].trade_network_id
      );
    });
  });

  describe('Network Service Error Handling', function () {
    it('should handle invalid network ID', async function () {
      const network = await NetworkService.getNetworkById(99999);
      expect(network).to.be.null;
    });

    it('should handle invalid network name', async function () {
      const network = await NetworkService.getNetworkByName('invalid-network');
      expect(network).to.be.null;
    });

    it('should handle invalid network family', async function () {
      const networks = await NetworkService.getNetworksByFamily('invalid-family' as NetworkFamily);
      expect(networks).to.be.an('array');
      expect(networks.length).to.equal(0);
    });

    it('should handle blockchain service creation errors gracefully', function () {
      const invalidNetwork = {
        id: 999,
        name: 'invalid-network' as any,
        networkFamily: 'invalid-family' as any,
        rpcUrl: 'http://invalid-url',
        isActive: true,
        isTestnet: true,
        chainId: 0,
        arbitratorAddress: '1111111111111111111111111111111111111111111',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(() => BlockchainServiceFactory.create(invalidNetwork)).to.throw();
    });
  });

  describe('Network Service Performance', function () {
    it('should retrieve networks quickly', async function () {
      const startTime = Date.now();

      const networks = NetworkService.getAllNetworks();
      const networkById = await NetworkService.getNetworkById(solanaDevnetNetwork.id);
      const networkByName = await NetworkService.getNetworkByName('solana-devnet');
      const networksByFamily = await NetworkService.getNetworksByFamily(NetworkFamily.SOLANA);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(networks).to.exist;
      expect(networkById).to.exist;
      expect(networkByName).to.exist;
      expect(networksByFamily).to.exist;
      expect(duration).to.be.lessThan(100); // Should complete within 100ms
    });

    it('should provide consistent results across multiple calls', async function () {
      const networks1 = await NetworkService.getAllNetworks();
      const networks2 = await NetworkService.getAllNetworks();

      // Both should return the same content (cached)
      expect(networks1).to.have.length(networks2.length);
      expect(networks1).to.deep.equal(networks2);
    });
  });
});
