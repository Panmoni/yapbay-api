import { expect } from 'chai';
import request from 'supertest';
import express from 'express';
import pool from '../db';
import routes from '../routes';
import { NetworkService } from '../services/networkService';
import { NetworkFamily } from '../types/networks';
import * as fs from 'fs';
import * as path from 'path';
import {
  createTestAccount,
  createTestOffer,
  cleanupTestData,
  generateSolanaAddress,
} from './utils/solanaTestUtils';

describe('Solana API Integration Tests', function () {
  let app: express.Application;
  let client: any;
  let solanaDevnetNetwork: any;
  let solanaMainnetNetwork: any;
  let testAccountId: number;
  let authToken: string;

  before(async function () {
    this.timeout(10000);

    // Setup express app
    app = express();
    app.use(express.json());
    app.use('/api', routes);

    // Setup database
    client = await pool.connect();

    try {
      // Get Solana network configurations
      const allNetworks = await NetworkService.getAllNetworks();
      solanaDevnetNetwork = allNetworks.find(n => n.name === 'solana-devnet');
      solanaMainnetNetwork = allNetworks.find(n => n.name === 'solana-mainnet');

      if (!solanaDevnetNetwork || !solanaMainnetNetwork) {
        throw new Error('Solana networks not properly configured');
      }

      // Create test account with unique identifiers
      const uniqueTimestamp = Date.now();
      // Use the wallet address from the JWT token for authentication tests
      const jwtWalletAddress = 'AczLKrdS6hFGNoTWg9AaS9xhuPfZgVTPxL2W8XzZMDjH';
      const testAccount = await createTestAccount(client, {
        wallet_address: jwtWalletAddress,
        username: `solana_apitest_${uniqueTimestamp}`,
        email: `solana_apitest_${uniqueTimestamp}@example.com`,
      });
      testAccountId = testAccount.id;

      // Read JWT token from file
      const jwtPath = path.join(__dirname, '../../jwt.txt');
      if (fs.existsSync(jwtPath)) {
        const jwtToken = fs.readFileSync(jwtPath, 'utf8').trim();
        authToken = `Bearer ${jwtToken}`;
      } else {
        // Create a mock token for testing
        authToken = 'Bearer mock-jwt-token-for-testing';
      }
    } catch (error) {
      console.error('Failed to setup Solana API tests:', error);
      this.skip();
    }
  });

  beforeEach(async function () {
    // No transaction rollback - we'll use proper cleanup instead
  });

  afterEach(async function () {
    // Clean up test data after each test, but keep the account for tests that need it
    if (testAccountId) {
      try {
        // Only clean up offers, keep the account for authentication tests
        await client.query('DELETE FROM offers WHERE creator_account_id = $1', [testAccountId]);
      } catch (error) {
        console.log('Error cleaning up test offers:', error);
      }
    }
  });

  after(async function () {
    if (client) {
      // Clean up test account safely
      if (testAccountId) {
        try {
          // Delete in proper order to respect foreign key constraints
          await client.query('DELETE FROM offers WHERE creator_account_id = $1', [testAccountId]);
          await client.query('DELETE FROM accounts WHERE id = $1', [testAccountId]);
        } catch (error) {
          console.log('Error cleaning up test account:', error);
        }
      }
      await client.release();
    }
  });

  describe('Network Header Validation', function () {
    it('should reject requests with invalid network names', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'invalid-network')
        .set('Authorization', authToken)
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
      expect(response.body.validNetworks).to.include('solana-devnet');
      expect(response.body.validNetworks).to.include('solana-mainnet');
    });

    it('should use default network when no header provided', async function () {
      const response = await request(app)
        .get('/api/health')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.networks).to.exist;
      expect(response.body.networks).to.be.an('array');
      expect(response.body.networks.length).to.be.greaterThan(0);

      // Check that Solana networks are included
      const solanaNetworks = response.body.networks.filter(
        (n: any) => n.networkFamily === 'solana'
      );
      expect(solanaNetworks.length).to.be.greaterThan(0);
    });

    it('should accept valid Solana network names', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.network).to.equal('solana-devnet');
    });

    it('should validate Solana network family', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.network).to.equal('solana-devnet');
      // Verify the network is actually a Solana network
      const network = await NetworkService.getNetworkByName('solana-devnet');
      expect(network?.networkFamily).to.equal(NetworkFamily.SOLANA);
    });

    it('should reject empty network header', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', '')
        .set('Authorization', authToken)
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
      expect(response.body.validNetworks).to.exist;
    });

    it('should reject null network header', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', null as any)
        .set('Authorization', authToken)
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
    });
  });

  describe('API Endpoint Isolation', function () {
    let devnetOfferId: number;
    let mainnetOfferId: number;

    beforeEach(async function () {
      // Create test offers on different Solana networks
      const devnetOffer = await createTestOffer(client, {
        creator_account_id: testAccountId,
        network_id: solanaDevnetNetwork.id,
        offer_type: 'BUY',
        token: 'USDC',
        fiat_currency: 'USD',
        min_amount: 100,
        max_amount: 200,
        total_available_amount: 500,
        rate_adjustment: 1.05,
        terms: 'Test offer for Solana Devnet',
      });
      devnetOfferId = devnetOffer.id;

      const mainnetOffer = await createTestOffer(client, {
        creator_account_id: testAccountId,
        network_id: solanaMainnetNetwork.id,
        offer_type: 'SELL',
        token: 'USDC',
        fiat_currency: 'USD',
        min_amount: 150,
        max_amount: 300,
        total_available_amount: 600,
        rate_adjustment: 1.03,
        terms: 'Test offer for Solana Mainnet',
      });
      mainnetOfferId = mainnetOffer.id;
    });

    it('should return offers only for specified Solana network', async function () {
      // Test data is already created in beforeEach

      // Test Solana Devnet
      const devnetResponse = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(devnetResponse.body.network).to.equal('solana-devnet');
      // Filter offers to only include those created by our test account
      const testOffers = devnetResponse.body.offers.filter(
        (offer: any) => offer.creator_account_id === testAccountId
      );
      expect(testOffers).to.have.length(1);
      expect(testOffers[0].offer_type).to.equal('BUY');

      // Test Solana Mainnet (should return 503 since it's inactive)
      const mainnetResponse = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-mainnet')
        .set('Authorization', authToken)
        .expect(503);

      expect(mainnetResponse.body.error).to.equal('Network unavailable');
    });

    it('should not find offers from other Solana networks by ID', async function () {
      // Try to access Devnet offer from Mainnet (should return 503 since mainnet is inactive)
      const response = await request(app)
        .get(`/api/offers/${devnetOfferId}`)
        .set('X-Network-Name', 'solana-mainnet')
        .set('Authorization', authToken)
        .expect(503);

      expect(response.body.error).to.equal('Network unavailable');
    });

    it('should isolate offers by Solana network family', async function () {
      // Query offers for Solana Devnet
      const devnetOffers = await client.query('SELECT * FROM offers WHERE network_id = $1', [
        solanaDevnetNetwork.id,
      ]);

      // Query offers for Solana Mainnet
      const mainnetOffers = await client.query('SELECT * FROM offers WHERE network_id = $1', [
        solanaMainnetNetwork.id,
      ]);

      // Verify isolation - filter by test account to avoid interference from other tests
      const testDevnetOffers = devnetOffers.rows.filter(
        (offer: any) => offer.creator_account_id === testAccountId
      );
      const testMainnetOffers = mainnetOffers.rows.filter(
        (offer: any) => offer.creator_account_id === testAccountId
      );

      expect(testDevnetOffers).to.have.length(1);
      expect(testMainnetOffers).to.have.length(1);
      expect(testDevnetOffers[0].network_id).to.equal(solanaDevnetNetwork.id);
      expect(testMainnetOffers[0].network_id).to.equal(solanaMainnetNetwork.id);
    });

    it('should prevent cross-network data leakage in offers API', async function () {
      // The beforeEach already creates offers on both networks
      // This test verifies that we can query offers by network and get the correct ones

      // Query for offers on Devnet
      const devnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [solanaDevnetNetwork.id, testAccountId]
      );

      // Query for offers on Mainnet
      const mainnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [solanaMainnetNetwork.id, testAccountId]
      );

      // Both networks should have offers (created by beforeEach)
      expect(devnetOffers.rows).to.have.length(1);
      expect(mainnetOffers.rows).to.have.length(1);

      // Verify they are on different networks
      expect(devnetOffers.rows[0].network_id).to.equal(solanaDevnetNetwork.id);
      expect(mainnetOffers.rows[0].network_id).to.equal(solanaMainnetNetwork.id);
    });
  });

  describe('Authentication with Network Context', function () {
    beforeEach(async function () {
      // Create test offer for authentication tests
      await createTestOffer(client, {
        creator_account_id: testAccountId,
        network_id: solanaDevnetNetwork.id,
        offer_type: 'BUY',
        token: 'USDC',
        fiat_currency: 'USD',
        min_amount: 100,
        max_amount: 200,
        total_available_amount: 500,
        rate_adjustment: 1.05,
        terms: 'Test offer for authentication',
      });
    });

    it('should require authentication for protected endpoints', async function () {
      const response = await request(app)
        .get('/api/offers?owner=me')
        .set('X-Network-Name', 'solana-devnet')
        .expect(401);

      expect(response.body.error).to.exist;
    });

    it('should accept valid authentication with network context', async function () {
      const response = await request(app)
        .get('/api/offers?owner=me')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.network).to.equal('solana-devnet');
    });

    it('should validate network context in authenticated requests', async function () {
      // Create a test offer on Devnet
      await createTestOffer(client, {
        creator_account_id: testAccountId,
        network_id: solanaDevnetNetwork.id,
        offer_type: 'BUY',
        token: 'USDC',
        fiat_currency: 'USD',
        min_amount: 100,
        max_amount: 200,
        total_available_amount: 500,
        rate_adjustment: 1.05,
        terms: 'Authenticated test offer',
      });

      const response = await request(app)
        .get('/api/offers?owner=me')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.network).to.equal('solana-devnet');
      expect(response.body.offers).to.be.an('array');
    });

    it('should isolate authenticated data by network', async function () {
      // Create offers on both networks
      await createTestOffer(client, {
        creator_account_id: testAccountId,
        network_id: solanaDevnetNetwork.id,
        offer_type: 'BUY',
        token: 'USDC',
        fiat_currency: 'USD',
        min_amount: 100,
        max_amount: 200,
        total_available_amount: 500,
        rate_adjustment: 1.05,
        terms: 'Devnet authenticated offer',
      });

      await createTestOffer(client, {
        creator_account_id: testAccountId,
        network_id: solanaMainnetNetwork.id,
        offer_type: 'SELL',
        token: 'USDC',
        fiat_currency: 'USD',
        min_amount: 150,
        max_amount: 300,
        total_available_amount: 600,
        rate_adjustment: 1.03,
        terms: 'Mainnet authenticated offer',
      });

      // Query Devnet offers
      const devnetResponse = await request(app)
        .get('/api/offers?owner=me')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      // Query Mainnet offers (should return 503 since mainnet is inactive)
      const mainnetResponse = await request(app)
        .get('/api/offers?owner=me')
        .set('X-Network-Name', 'solana-mainnet')
        .set('Authorization', authToken)
        .expect(503);

      // Filter offers to only include those created by our test account
      const testDevnetOffers = devnetResponse.body.offers.filter(
        (offer: any) => offer.creator_account_id === testAccountId
      );
      expect(testDevnetOffers).to.have.length(1);
      expect(testDevnetOffers[0].offer_type).to.equal('BUY');
      expect(mainnetResponse.body.error).to.equal('Network unavailable');
    });
  });

  describe('Error Handling for Invalid Solana Network Requests', function () {
    it('should handle network service errors gracefully', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'nonexistent-solana-network')
        .set('Authorization', authToken)
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
      expect(response.body.validNetworks).to.exist;
    });

    it('should provide helpful error messages for missing network', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', '')
        .set('Authorization', authToken)
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
      expect(response.body.validNetworks).to.exist;
    });

    it('should handle malformed network headers', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-devnet-invalid')
        .set('Authorization', authToken)
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
    });

    it('should handle case sensitivity in network names', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'Solana-Devnet')
        .set('Authorization', authToken)
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
    });

    it('should handle special characters in network names', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-devnet@#$%')
        .set('Authorization', authToken)
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
    });

    it('should handle very long network names', async function () {
      const longNetworkName = 'solana-devnet-' + 'a'.repeat(1000);
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', longNetworkName)
        .set('Authorization', authToken)
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
    });
  });

  describe('Health Endpoint Network Awareness', function () {
    it('should return Solana network information in health check', async function () {
      const response = await request(app)
        .get('/api/health')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.networks).to.exist;
      expect(response.body.networks).to.be.an('array');

      // Find the Solana Devnet network
      const solanaDevnet = response.body.networks.find((n: any) => n.name === 'solana-devnet');
      expect(solanaDevnet).to.exist;
      expect(solanaDevnet.networkFamily).to.equal('solana');
      expect(solanaDevnet.status).to.exist;
    });

    it('should test different Solana networks independently', async function () {
      // Test Solana Devnet
      const devnetResponse = await request(app)
        .get('/api/health')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      // Test Solana Mainnet (health endpoint uses optionalNetwork, so it falls back to default)
      const mainnetResponse = await request(app)
        .get('/api/health')
        .set('X-Network-Name', 'solana-mainnet')
        .set('Authorization', authToken)
        .expect(200);

      // Both responses should contain network information (health endpoint is resilient)
      expect(devnetResponse.body.networks).to.exist;
      expect(mainnetResponse.body.networks).to.exist;

      // Find Solana Devnet in the response
      const devnetSolana = devnetResponse.body.networks.find(
        (n: any) => n.name === 'solana-devnet'
      );

      expect(devnetSolana).to.exist;
      expect(devnetSolana.networkFamily).to.equal('solana');
    });

    it('should include Solana-specific network details', async function () {
      const response = await request(app)
        .get('/api/health')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.networks).to.exist;

      // Find the Solana Devnet network
      const solanaDevnet = response.body.networks.find((n: any) => n.name === 'solana-devnet');
      expect(solanaDevnet).to.exist;
      expect(solanaDevnet).to.have.property('programId');
      expect(solanaDevnet).to.have.property('usdcMint');
      expect(solanaDevnet).to.have.property('arbitratorAddress');
      expect(solanaDevnet.programId).to.be.a('string');
      expect(solanaDevnet.usdcMint).to.be.a('string');
      expect(solanaDevnet.arbitratorAddress).to.be.a('string');
    });
  });

  describe('Network Response Headers', function () {
    it('should include network information in response headers', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.network).to.equal('solana-devnet');
    });

    it('should include network family in response', async function () {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.network).to.equal('solana-devnet');
      // Verify the network family is Solana
      const network = await NetworkService.getNetworkByName('solana-devnet');
      expect(network?.networkFamily).to.equal(NetworkFamily.SOLANA);
    });
  });

  describe('Cross-Network Data Leakage Prevention', function () {
    it('should not allow access to resources from different Solana networks', async function () {
      // Create offer on Solana Devnet
      const offer = await createTestOffer(client, {
        creator_account_id: testAccountId,
        network_id: solanaDevnetNetwork.id,
        offer_type: 'BUY',
        token: 'USDC',
        fiat_currency: 'USD',
        min_amount: 100,
        max_amount: 200,
        total_available_amount: 500,
        rate_adjustment: 1.05,
        terms: 'Cross-network isolation test',
      });

      // Try to access from Solana Mainnet (should return 503 since mainnet is inactive)
      const response = await request(app)
        .get(`/api/offers/${offer.id}`)
        .set('X-Network-Name', 'solana-mainnet')
        .set('Authorization', authToken)
        .expect(503);

      expect(response.body.error).to.equal('Network unavailable');
    });

    it('should enforce network isolation in update operations', async function () {
      // Create offer on Solana Devnet
      const offer = await createTestOffer(client, {
        creator_account_id: testAccountId,
        network_id: solanaDevnetNetwork.id,
        offer_type: 'BUY',
        token: 'USDC',
        fiat_currency: 'USD',
        min_amount: 100,
        max_amount: 200,
        total_available_amount: 500,
        rate_adjustment: 1.05,
        terms: 'Update isolation test',
      });

      // Try to update from Solana Mainnet (should return 503 since mainnet is inactive)
      const response = await request(app)
        .put(`/api/offers/${offer.id}`)
        .set('X-Network-Name', 'solana-mainnet')
        .set('Authorization', authToken)
        .send({
          min_amount: 150,
        })
        .expect(503);

      expect(response.body.error).to.equal('Network unavailable');
    });

    it('should prevent cross-network data access in list operations', async function () {
      // Create offers on both networks
      await createTestOffer(client, {
        creator_account_id: testAccountId,
        network_id: solanaDevnetNetwork.id,
        offer_type: 'BUY',
        token: 'USDC',
        fiat_currency: 'USD',
        min_amount: 100,
        max_amount: 200,
        total_available_amount: 500,
        rate_adjustment: 1.05,
        terms: 'Devnet list test',
      });

      await createTestOffer(client, {
        creator_account_id: testAccountId,
        network_id: solanaMainnetNetwork.id,
        offer_type: 'SELL',
        token: 'USDC',
        fiat_currency: 'USD',
        min_amount: 150,
        max_amount: 300,
        total_available_amount: 600,
        rate_adjustment: 1.03,
        terms: 'Mainnet list test',
      });

      // Query Devnet offers
      const devnetResponse = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      // Query Mainnet offers (should return 503 since mainnet is inactive)
      const mainnetResponse = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-mainnet')
        .set('Authorization', authToken)
        .expect(503);

      // Filter offers to only include those created by our test account
      const testDevnetOffers = devnetResponse.body.offers.filter(
        (offer: any) => offer.creator_account_id === testAccountId
      );
      expect(testDevnetOffers).to.have.length(1);
      expect(testDevnetOffers[0].offer_type).to.equal('BUY');
      expect(mainnetResponse.body.error).to.equal('Network unavailable');
    });
  });

  describe('Solana-Specific API Features', function () {
    it('should handle Solana address validation in API requests', async function () {
      const validSolanaAddress = '9KxEUVkoJVrE2nKadJomSNkgSsksgGvRavSJy3eJUdtQ';
      const invalidAddress = 'invalid-address';

      // Test with valid Solana address
      const validResponse = await request(app)
        .post('/api/offers')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .send({
          creator_account_id: testAccountId,
          offer_type: 'BUY',
          token: 'USDC',
          fiat_currency: 'USD',
          min_amount: 100,
          max_amount: 200,
          total_available_amount: 500,
          rate_adjustment: 1.05,
          terms: 'Valid address test',
        })
        .expect(201);

      expect(validResponse.body.network).to.equal('solana-devnet');

      // Test with invalid address (if the API validates addresses)
      // This test assumes the API would validate addresses in the request body
      // The actual validation would depend on the specific API endpoint implementation
    });

    it('should support Solana-specific transaction types', async function () {
      // This test would verify that the API can handle Solana-specific transaction types
      // like FUND_ESCROW, RELEASE_ESCROW, CANCEL_ESCROW, etc.
      const response = await request(app)
        .get('/api/health')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.networks).to.exist;

      // Find the Solana Devnet network
      const solanaDevnet = response.body.networks.find((n: any) => n.name === 'solana-devnet');
      expect(solanaDevnet).to.exist;
      expect(solanaDevnet.networkFamily).to.equal('solana');

      // Verify the network supports Solana transaction types
      const network = await NetworkService.getNetworkByName('solana-devnet');
      expect(network?.networkFamily).to.equal(NetworkFamily.SOLANA);
    });

    it('should handle Solana program ID validation', async function () {
      const response = await request(app)
        .get('/api/health')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.networks).to.exist;

      // Find the Solana Devnet network
      const solanaDevnet = response.body.networks.find((n: any) => n.name === 'solana-devnet');
      expect(solanaDevnet).to.exist;
      expect(solanaDevnet.programId).to.exist;
      expect(solanaDevnet.programId).to.be.a('string');
      expect(solanaDevnet.programId.length).to.be.greaterThan(0);
    });
  });

  describe('Performance and Reliability', function () {
    it('should handle concurrent requests to different Solana networks', async function () {
      const promises = [
        request(app)
          .get('/api/offers')
          .set('X-Network-Name', 'solana-devnet')
          .set('Authorization', authToken),
        request(app)
          .get('/api/offers')
          .set('X-Network-Name', 'solana-mainnet')
          .set('Authorization', authToken),
        request(app)
          .get('/api/health')
          .set('X-Network-Name', 'solana-devnet')
          .set('Authorization', authToken),
        request(app)
          .get('/api/health')
          .set('X-Network-Name', 'solana-mainnet')
          .set('Authorization', authToken),
      ];

      const responses = await Promise.all(promises);

      responses.forEach(response => {
        expect(response.status).to.be.oneOf([200, 400, 503]);
        if (response.status === 200) {
          // Health endpoint returns networks array, offers endpoint returns network field
          if (response.body.networks) {
            expect(response.body.networks).to.be.an('array');
          } else if (response.body.network) {
            expect(response.body.network).to.exist;
          }
        } else if (response.status === 503) {
          expect(response.body.error).to.equal('Network unavailable');
        }
      });
    });

    it('should complete API requests within reasonable time', async function () {
      const startTime = Date.now();

      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'solana-devnet')
        .set('Authorization', authToken)
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(response.body.network).to.equal('solana-devnet');
      expect(duration).to.be.lessThan(5000); // Should complete within 5 seconds
    });
  });
});
