import { expect } from 'chai';
import pool from '../db';
import { NetworkService } from '../services/networkService';
import { NetworkType, NetworkConfig } from '../types/networks';

describe('Simple Multi-Network Tests', function() {
  let client: any;
  
  before(async function() {
    this.timeout(10000);
    client = await pool.connect();
  });

  after(async function() {
    if (client) {
      await client.release();
    }
  });

  describe('Network Configuration', function() {
    it('should have active networks configured', async function() {
      const networks = await NetworkService.getActiveNetworks();
      expect(networks).to.be.an('array');
      expect(networks.length).to.be.greaterThan(0);
      
      const networkNames = networks.map((n: NetworkConfig) => n.name);
      expect(networkNames).to.include('celo-alfajores');
      expect(networkNames).to.include('celo-mainnet');
    });

    it('should get network by name', async function() {
      const alfajores = await NetworkService.getNetworkByName(NetworkType.CELO_ALFAJORES);
      const mainnet = await NetworkService.getNetworkByName(NetworkType.CELO_MAINNET);
      
      expect(alfajores).to.not.be.null;
      expect(mainnet).to.not.be.null;
      expect(alfajores?.chainId).to.equal(44787);
      expect(mainnet?.chainId).to.equal(42220);
    });
  });

  describe('Database Network Isolation', function() {
    beforeEach(async function() {
      await client.query('BEGIN');
    });

    afterEach(async function() {
      await client.query('ROLLBACK');
    });

    it('should isolate offers by network', async function() {
      const alfajores = await NetworkService.getNetworkByName(NetworkType.CELO_ALFAJORES);
      const mainnet = await NetworkService.getNetworkByName(NetworkType.CELO_MAINNET);

      if (!alfajores || !mainnet) {
        throw new Error('Networks not configured');
      }

      // Create test account with unique wallet address
      const uniqueWallet = `0x${Date.now().toString(16).padStart(40, '0')}`;
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `testuser_${Date.now()}`, `test_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      // Create offer on Alfajores
      await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [accountId, 'BUY', 100, 200, 500, 1.05, alfajores.id]
      );

      // Create offer on Mainnet
      await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [accountId, 'SELL', 150, 300, 600, 1.03, mainnet.id]
      );

      // Query offers by network AND account to ensure we only get our test data
      const alfajoresOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [alfajores.id, accountId]
      );
      
      const mainnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [mainnet.id, accountId]
      );

      // Verify isolation
      expect(alfajoresOffers.rows).to.have.length(1);
      expect(mainnetOffers.rows).to.have.length(1);
      expect(alfajoresOffers.rows[0].offer_type).to.equal('BUY');
      expect(mainnetOffers.rows[0].offer_type).to.equal('SELL');
    });

    it('should isolate trades by network', async function() {
      const alfajores = await NetworkService.getNetworkByName(NetworkType.CELO_ALFAJORES);
      const mainnet = await NetworkService.getNetworkByName(NetworkType.CELO_MAINNET);

      if (!alfajores || !mainnet) {
        throw new Error('Networks not configured');
      }

      // Create test account with unique wallet address
      const uniqueWallet = `0x${Date.now().toString(16).padStart(40, '1')}`;
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `testuser2_${Date.now()}`, `test2_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      // Create trade on Alfajores
      const alfajoresTradeResult = await client.query(
        'INSERT INTO trades (overall_status, from_fiat_currency, destination_fiat_currency, leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_amount, leg1_fiat_currency, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
        ['IN_PROGRESS', 'USD', 'USD', 'CREATED', accountId, accountId, 100, 'USD', alfajores.id]
      );
      const alfajoresTradeId = alfajoresTradeResult.rows[0].id;

      // Create trade on Mainnet
      const mainnetTradeResult = await client.query(
        'INSERT INTO trades (overall_status, from_fiat_currency, destination_fiat_currency, leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_amount, leg1_fiat_currency, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
        ['IN_PROGRESS', 'EUR', 'EUR', 'FUNDED', accountId, accountId, 200, 'EUR', mainnet.id]
      );
      const mainnetTradeId = mainnetTradeResult.rows[0].id;

      // Query trades by network AND specific IDs to ensure we only get our test data
      const alfajoresTrades = await client.query(
        'SELECT * FROM trades WHERE network_id = $1 AND id = $2',
        [alfajores.id, alfajoresTradeId]
      );
      
      const mainnetTrades = await client.query(
        'SELECT * FROM trades WHERE network_id = $1 AND id = $2',
        [mainnet.id, mainnetTradeId]
      );

      // Verify isolation
      expect(alfajoresTrades.rows).to.have.length(1);
      expect(mainnetTrades.rows).to.have.length(1);
      expect(alfajoresTrades.rows[0].from_fiat_currency).to.equal('USD');
      expect(mainnetTrades.rows[0].from_fiat_currency).to.equal('EUR');
    });
  });

  describe('Cross-Network Data Prevention', function() {
    beforeEach(async function() {
      await client.query('BEGIN');
    });

    afterEach(async function() {
      await client.query('ROLLBACK');
    });

    it('should not find offers from other networks', async function() {
      const alfajores = await NetworkService.getNetworkByName(NetworkType.CELO_ALFAJORES);
      const mainnet = await NetworkService.getNetworkByName(NetworkType.CELO_MAINNET);

      if (!alfajores || !mainnet) {
        throw new Error('Networks not configured');
      }

      // Create test account with unique wallet address
      const uniqueWallet = `0x${Date.now().toString(16).padStart(40, '2')}`;
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        [uniqueWallet, `testuser3_${Date.now()}`, `test3_${Date.now()}@example.com`]
      );
      const accountId = accountResult.rows[0].id;

      // Create offer on Alfajores only
      await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [accountId, 'BUY', 100, 200, 500, 1.05, alfajores.id]
      );

      // Query for offers on Mainnet for this specific account (should find none)
      const mainnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1 AND creator_account_id = $2',
        [mainnet.id, accountId]
      );

      expect(mainnetOffers.rows).to.have.length(0);
    });
  });
});