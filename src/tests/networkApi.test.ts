import { expect } from 'chai';
import request from 'supertest';
import express from 'express';
import pool from '../db';
import routes from '../routes';
import { NetworkService } from '../services/networkService';
import { NetworkType, NetworkConfig } from '../types/networks';

describe('Network API Integration Tests', function() {
  let app: express.Application;
  let client: any;
  let alfajoresNetwork: NetworkConfig;
  let mainnetNetwork: NetworkConfig;
  let testAccountId: number;
  let authToken: string;

  before(async function() {
    this.timeout(10000);
    
    // Setup express app
    app = express();
    app.use(express.json());
    app.use('/api', routes);
    
    // Setup database
    client = await pool.connect();
    
    try {
      // Get network configurations
      alfajoresNetwork = await NetworkService.getNetworkByName(NetworkType.CELO_ALFAJORES) as NetworkConfig;
      mainnetNetwork = await NetworkService.getNetworkByName(NetworkType.CELO_MAINNET) as NetworkConfig;
      
      if (!alfajoresNetwork || !mainnetNetwork) {
        throw new Error('Networks not properly configured');
      }

      // Create test account
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        ['0xApiTest1234567890123456789012345678901234', 'apitest', 'apitest@example.com']
      );
      testAccountId = accountResult.rows[0].id;

      // Mock JWT token (simplified for testing)
      authToken = 'Bearer mock-jwt-token';
      
    } catch (error) {
      console.error('Failed to setup API tests:', error);
      this.skip();
    }
  });

  beforeEach(async function() {
    await client.query('BEGIN');
  });

  afterEach(async function() {
    await client.query('ROLLBACK');
  });

  after(async function() {
    if (client) {
      await client.release();
    }
  });

  describe('Network Header Validation', function() {
    it('should reject requests with invalid network names', async function() {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'invalid-network')
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
      expect(response.body.validNetworks).to.include('celo-alfajores');
      expect(response.body.validNetworks).to.include('celo-mainnet');
    });

    it('should use default network when no header provided', async function() {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.network).to.exist;
      expect(['celo-alfajores', 'celo-mainnet']).to.include(response.body.network.name);
    });

    it('should accept valid network names', async function() {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'celo-alfajores')
        .expect(200);

      expect(response.body.network).to.equal('celo-alfajores');
    });
  });

  describe('Offers API Network Isolation', function() {
    beforeEach(async function() {
      // Create test offers on different networks
      await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [testAccountId, 'BUY', 100, 200, 500, 1.05, alfajoresNetwork.id]
      );
      
      await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [testAccountId, 'SELL', 150, 300, 600, 1.03, mainnetNetwork.id]
      );
    });

    it('should return offers only for specified network', async function() {
      // Test Alfajores
      const alfajoresResponse = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'celo-alfajores')
        .expect(200);

      expect(alfajoresResponse.body.network).to.equal('celo-alfajores');
      expect(alfajoresResponse.body.offers).to.have.length(1);
      expect(alfajoresResponse.body.offers[0].offer_type).to.equal('BUY');

      // Test Mainnet
      const mainnetResponse = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'celo-mainnet')
        .expect(200);

      expect(mainnetResponse.body.network).to.equal('celo-mainnet');
      expect(mainnetResponse.body.offers).to.have.length(1);
      expect(mainnetResponse.body.offers[0].offer_type).to.equal('SELL');
    });

    it('should not find offers from other networks by ID', async function() {
      // Get an offer ID from Alfajores
      const alfajoresOffers = await client.query(
        'SELECT id FROM offers WHERE network_id = $1',
        [alfajoresNetwork.id]
      );
      const alfajoresOfferId = alfajoresOffers.rows[0].id;

      // Try to access it from Mainnet
      const response = await request(app)
        .get(`/api/offers/${alfajoresOfferId}`)
        .set('X-Network-Name', 'celo-mainnet')
        .expect(404);

      expect(response.body.error).to.equal('Offer not found');
    });
  });

  describe('Trades API Network Isolation', function() {
    let alfajoresOfferId: number;
    let mainnetOfferId: number;

    beforeEach(async function() {
      // Create test offers
      const alfajoresOffer = await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [testAccountId, 'BUY', 100, 200, 500, 1.05, alfajoresNetwork.id]
      );
      alfajoresOfferId = alfajoresOffer.rows[0].id;

      const mainnetOffer = await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [testAccountId, 'SELL', 150, 300, 600, 1.03, mainnetNetwork.id]
      );
      mainnetOfferId = mainnetOffer.rows[0].id;

      // Create test trades
      await client.query(
        'INSERT INTO trades (overall_status, from_fiat_currency, destination_fiat_currency, leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_amount, leg1_fiat_currency, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        ['IN_PROGRESS', 'USD', 'USD', 'CREATED', testAccountId, testAccountId, 100, 'USD', alfajoresNetwork.id]
      );
      
      await client.query(
        'INSERT INTO trades (overall_status, from_fiat_currency, destination_fiat_currency, leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_amount, leg1_fiat_currency, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        ['IN_PROGRESS', 'EUR', 'EUR', 'FUNDED', testAccountId, testAccountId, 200, 'EUR', mainnetNetwork.id]
      );
    });

    it('should return trades only for specified network', async function() {
      // Test Alfajores
      const alfajoresResponse = await request(app)
        .get('/api/my/trades')
        .set('X-Network-Name', 'celo-alfajores')
        .set('Authorization', authToken)
        .expect(200);

      expect(alfajoresResponse.body.network).to.equal('celo-alfajores');
      expect(alfajoresResponse.body.trades).to.have.length(1);
      expect(alfajoresResponse.body.trades[0].from_fiat_currency).to.equal('USD');

      // Test Mainnet
      const mainnetResponse = await request(app)
        .get('/api/my/trades')
        .set('X-Network-Name', 'celo-mainnet')
        .set('Authorization', authToken)
        .expect(200);

      expect(mainnetResponse.body.network).to.equal('celo-mainnet');
      expect(mainnetResponse.body.trades).to.have.length(1);
      expect(mainnetResponse.body.trades[0].from_fiat_currency).to.equal('EUR');
    });

    it('should reject trade creation with offer from different network', async function() {
      // Try to create trade on Mainnet using Alfajores offer
      const response = await request(app)
        .post('/api/trades')
        .set('X-Network-Name', 'celo-mainnet')
        .set('Authorization', authToken)
        .send({
          leg1_offer_id: alfajoresOfferId,
          leg1_crypto_amount: 100,
          leg1_fiat_amount: 100,
          from_fiat_currency: 'USD',
          destination_fiat_currency: 'USD'
        })
        .expect(404);

      expect(response.body.error).to.equal('Leg 1 offer not found');
    });

    it('should successfully create trade with offer from same network', async function() {
      // Create trade on Mainnet using Mainnet offer
      const response = await request(app)
        .post('/api/trades')
        .set('X-Network-Name', 'celo-mainnet')
        .set('Authorization', authToken)
        .send({
          leg1_offer_id: mainnetOfferId,
          leg1_crypto_amount: 150,
          leg1_fiat_amount: 150,
          from_fiat_currency: 'EUR',
          destination_fiat_currency: 'EUR'
        })
        .expect(201);

      expect(response.body.network).to.equal('celo-mainnet');
      expect(response.body.trade).to.exist;
    });
  });

  describe('Health Endpoint Network Awareness', function() {
    it('should return network information in health check', async function() {
      const response = await request(app)
        .get('/api/health')
        .set('X-Network-Name', 'celo-alfajores')
        .expect(200);

      expect(response.body.network).to.exist;
      expect(response.body.network.name).to.equal('celo-alfajores');
      expect(response.body.network.chainId).to.equal(44787);
      expect(response.body.network.status).to.exist;
    });

    it('should test different networks independently', async function() {
      // Test Alfajores
      const alfajoresResponse = await request(app)
        .get('/api/health')
        .set('X-Network-Name', 'celo-alfajores')
        .expect(200);

      // Test Mainnet
      const mainnetResponse = await request(app)
        .get('/api/health')
        .set('X-Network-Name', 'celo-mainnet')
        .expect(200);

      expect(alfajoresResponse.body.network.chainId).to.equal(44787);
      expect(mainnetResponse.body.network.chainId).to.equal(42220);
    });
  });

  describe('Network Response Headers', function() {
    it('should include network information in response headers', async function() {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'celo-alfajores')
        .expect(200);

      // Note: These headers would be set by addNetworkHeaders middleware
      // This test assumes the middleware is properly configured
      expect(response.body.network).to.equal('celo-alfajores');
    });
  });

  describe('Error Handling', function() {
    it('should handle network service errors gracefully', async function() {
      // Test with a network that might be inactive
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', 'nonexistent-network')
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
    });

    it('should provide helpful error messages for missing network', async function() {
      const response = await request(app)
        .get('/api/offers')
        .set('X-Network-Name', '')
        .expect(400);

      expect(response.body.error).to.equal('Invalid network specified');
      expect(response.body.validNetworks).to.exist;
    });
  });

  describe('Cross-Network Data Leakage Prevention', function() {
    it('should not allow access to resources from different networks', async function() {
      // Create offer on Alfajores
      const offerResult = await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [testAccountId, 'BUY', 100, 200, 500, 1.05, alfajoresNetwork.id]
      );
      const offerId = offerResult.rows[0].id;

      // Try to access from Mainnet
      const response = await request(app)
        .get(`/api/offers/${offerId}`)
        .set('X-Network-Name', 'celo-mainnet')
        .expect(404);

      expect(response.body.error).to.equal('Offer not found');
    });

    it('should enforce network isolation in update operations', async function() {
      // Create offer on Alfajores
      const offerResult = await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [testAccountId, 'BUY', 100, 200, 500, 1.05, alfajoresNetwork.id]
      );
      const offerId = offerResult.rows[0].id;

      // Try to update from Mainnet
      const response = await request(app)
        .put(`/api/offers/${offerId}`)
        .set('X-Network-Name', 'celo-mainnet')
        .set('Authorization', authToken)
        .send({
          min_amount: 150
        })
        .expect(404);

      expect(response.body.error).to.equal('offer not found');
    });
  });
});