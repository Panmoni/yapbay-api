import { expect } from 'chai';
import pool from '../db';
import { CeloService } from '../celo';
import { NetworkService } from '../services/networkService';
import { NetworkType, NetworkConfig } from '../types/networks';
import { expireDeadlinesForNetwork } from '../services/deadlineService';

describe('Multi-Network Integration Tests', function() {
  let client: any;
  let alfajoresNetwork: NetworkConfig;
  let mainnetNetwork: NetworkConfig;
  let consoleLogStub: any;

  before(async function() {
    this.timeout(10000);
    
    client = await pool.connect();
    consoleLogStub = {
      restore: () => {},
      reset: () => {}
    };
    const originalLog = console.log;
    console.log = () => {};
    consoleLogStub.restore = () => { console.log = originalLog; };
    
    try {
      // Get network configurations
      alfajoresNetwork = await NetworkService.getNetworkByName(NetworkType.CELO_ALFAJORES) as NetworkConfig;
      mainnetNetwork = await NetworkService.getNetworkByName(NetworkType.CELO_MAINNET) as NetworkConfig;
      
      if (!alfajoresNetwork || !mainnetNetwork) {
        throw new Error('Networks not properly configured');
      }
    } catch (error) {
      console.error('Failed to setup networks:', error);
      this.skip();
    }
  });

  beforeEach(async function() {
    await client.query('BEGIN');
  });

  afterEach(async function() {
    await client.query('ROLLBACK');
    consoleLogStub.reset();
  });

  after(async function() {
    if (client) {
      await client.release();
    }
    if (consoleLogStub) {
      consoleLogStub.restore();
    }
  });

  describe('Network Service', function() {
    it('should return active networks', async function() {
      const networks = await NetworkService.getActiveNetworks();
      expect(networks).to.be.an('array');
      expect(networks.length).to.be.greaterThan(0);
      
      const networkNames = networks.map(n => n.name);
      expect(networkNames).to.include(NetworkType.CELO_ALFAJORES);
      expect(networkNames).to.include(NetworkType.CELO_MAINNET);
    });

    it('should get network by ID', async function() {
      const network = await NetworkService.getNetworkById(alfajoresNetwork.id);
      expect(network).to.not.be.null;
      expect(network!.name).to.equal(NetworkType.CELO_ALFAJORES);
      expect(network!.chainId).to.equal(44787);
    });

    it('should get network by name', async function() {
      const network = await NetworkService.getNetworkByName(NetworkType.CELO_MAINNET);
      expect(network).to.not.be.null;
      expect(network!.name).to.equal(NetworkType.CELO_MAINNET);
      expect(network!.chainId).to.equal(42220);
    });
  });

  describe('Celo Service Multi-Network', function() {
    it('should create providers for different networks', async function() {
      const alfajoresProvider = await CeloService.getProviderForNetwork(alfajoresNetwork.id);
      const mainnetProvider = await CeloService.getProviderForNetwork(mainnetNetwork.id);
      
      expect(alfajoresProvider).to.not.equal(mainnetProvider);
      
      const alfajoresNetwork_result = await alfajoresProvider.getNetwork();
      const mainnetNetwork_result = await mainnetProvider.getNetwork();
      
      expect(Number(alfajoresNetwork_result.chainId)).to.equal(44787);
      expect(Number(mainnetNetwork_result.chainId)).to.equal(42220);
    });

    it('should create contracts for different networks', async function() {
      const alfajoresContract = await CeloService.getContractForNetwork(alfajoresNetwork.id);
      const mainnetContract = await CeloService.getContractForNetwork(mainnetNetwork.id);
      
      expect(alfajoresContract.target).to.equal(alfajoresNetwork.contractAddress);
      expect(mainnetContract.target).to.equal(mainnetNetwork.contractAddress);
      expect(alfajoresContract.target).to.not.equal(mainnetContract.target);
    });
  });

  describe('Data Isolation', function() {
    it('should isolate offers by network', async function() {
      // Create test account
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        ['0x1234567890123456789012345678901234567890', 'testuser', 'test@example.com']
      );
      const accountId = accountResult.rows[0].id;

      // Create offer on Alfajores
      const alfajoresOffer = await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [accountId, 'BUY', 100, 200, 500, 1.05, alfajoresNetwork.id]
      );

      // Create offer on Mainnet
      const mainnetOffer = await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [accountId, 'SELL', 150, 300, 600, 1.03, mainnetNetwork.id]
      );

      // Query offers by network
      const alfajoresOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1',
        [alfajoresNetwork.id]
      );
      
      const mainnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1',
        [mainnetNetwork.id]
      );

      // Verify isolation
      expect(alfajoresOffers.rows).to.have.length(1);
      expect(mainnetOffers.rows).to.have.length(1);
      expect(alfajoresOffers.rows[0].id).to.equal(alfajoresOffer.rows[0].id);
      expect(mainnetOffers.rows[0].id).to.equal(mainnetOffer.rows[0].id);
      expect(alfajoresOffers.rows[0].offer_type).to.equal('BUY');
      expect(mainnetOffers.rows[0].offer_type).to.equal('SELL');
    });

    it('should isolate trades by network', async function() {
      // Create test account
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        ['0x1234567890123456789012345678901234567891', 'testuser2', 'test2@example.com']
      );
      const accountId = accountResult.rows[0].id;

      // Create trade on Alfajores
      const alfajoresTrade = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        ['IN_PROGRESS', 'USD', 'USD', 'CREATED', accountId, accountId, 100, 'USD', alfajoresNetwork.id]
      );

      // Create trade on Mainnet
      const mainnetTrade = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        ['IN_PROGRESS', 'EUR', 'EUR', 'FUNDED', accountId, accountId, 200, 'EUR', mainnetNetwork.id]
      );

      // Query trades by network
      const alfajoresTrades = await client.query(
        'SELECT * FROM trades WHERE network_id = $1',
        [alfajoresNetwork.id]
      );
      
      const mainnetTrades = await client.query(
        'SELECT * FROM trades WHERE network_id = $1',
        [mainnetNetwork.id]
      );

      // Verify isolation
      expect(alfajoresTrades.rows).to.have.length(1);
      expect(mainnetTrades.rows).to.have.length(1);
      expect(alfajoresTrades.rows[0].id).to.equal(alfajoresTrade.rows[0].id);
      expect(mainnetTrades.rows[0].id).to.equal(mainnetTrade.rows[0].id);
      expect(alfajoresTrades.rows[0].leg1_state).to.equal('CREATED');
      expect(mainnetTrades.rows[0].leg1_state).to.equal('FUNDED');
    });

    it('should isolate escrows by network', async function() {
      // Create test account
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        ['0x1234567890123456789012345678901234567892', 'testuser3', 'test3@example.com']
      );
      const accountId = accountResult.rows[0].id;

      // Create trade first
      const tradeResult = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        ['IN_PROGRESS', 'USD', 'USD', 'CREATED', accountId, accountId, 100, 'USD', alfajoresNetwork.id]
      );
      const tradeId = tradeResult.rows[0].id;

      // Create escrow on Alfajores
      await client.query(
        `INSERT INTO escrows (
          trade_id, escrow_address, onchain_escrow_id, seller_address, buyer_address,
          arbitrator_address, amount, current_balance, state, sequential,
          sequential_escrow_address, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          tradeId, alfajoresNetwork.contractAddress, '1', 
          '0x1234567890123456789012345678901234567892', '0x1234567890123456789012345678901234567893',
          '0x1234567890123456789012345678901234567894', 100, 0, 'CREATED', false,
          null, alfajoresNetwork.id
        ]
      );

      // Create escrow on Mainnet  
      await client.query(
        `INSERT INTO escrows (
          trade_id, escrow_address, onchain_escrow_id, seller_address, buyer_address,
          arbitrator_address, amount, current_balance, state, sequential,
          sequential_escrow_address, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          tradeId, mainnetNetwork.contractAddress, '1', 
          '0x1234567890123456789012345678901234567895', '0x1234567890123456789012345678901234567896',
          '0x1234567890123456789012345678901234567897', 200, 100, 'FUNDED', true,
          '0x1234567890123456789012345678901234567898', mainnetNetwork.id
        ]
      );

      // Query escrows by network
      const alfajoresEscrows = await client.query(
        'SELECT * FROM escrows WHERE network_id = $1',
        [alfajoresNetwork.id]
      );
      
      const mainnetEscrows = await client.query(
        'SELECT * FROM escrows WHERE network_id = $1',
        [mainnetNetwork.id]
      );

      // Verify isolation
      expect(alfajoresEscrows.rows).to.have.length(1);
      expect(mainnetEscrows.rows).to.have.length(1);
      expect(alfajoresEscrows.rows[0].escrow_address).to.equal(alfajoresNetwork.contractAddress);
      expect(mainnetEscrows.rows[0].escrow_address).to.equal(mainnetNetwork.contractAddress);
      expect(alfajoresEscrows.rows[0].state).to.equal('CREATED');
      expect(mainnetEscrows.rows[0].state).to.equal('FUNDED');
    });
  });

  describe('Multi-Network Deadline Processing', function() {
    it('should process deadlines separately per network', async function() {
      // Create test account
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        ['0x1234567890123456789012345678901234567893', 'deadlineuser', 'deadline@example.com']
      );
      const accountId = accountResult.rows[0].id;

      const past = new Date(Date.now() - 3600000).toISOString();

      // Create expired trade on Alfajores
      const alfajoresTrade = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, leg1_escrow_deposit_deadline, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        ['IN_PROGRESS', 'USD', 'USD', 'CREATED', accountId, accountId, 100, 'USD', past, alfajoresNetwork.id]
      );

      // Create expired trade on Mainnet
      const mainnetTrade = await client.query(
        `INSERT INTO trades (
          overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, leg1_escrow_deposit_deadline, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        ['IN_PROGRESS', 'EUR', 'EUR', 'CREATED', accountId, accountId, 200, 'EUR', past, mainnetNetwork.id]
      );

      // Commit so deadline service can see the trades
      await client.query('COMMIT');

      // Process deadlines for Alfajores only
      await expireDeadlinesForNetwork(alfajoresNetwork.id);

      // Start new transaction to check results
      await client.query('BEGIN');

      // Check results
      const alfajoresResult = await client.query(
        'SELECT overall_status, leg1_state FROM trades WHERE id = $1',
        [alfajoresTrade.rows[0].id]
      );
      
      const mainnetResult = await client.query(
        'SELECT overall_status, leg1_state FROM trades WHERE id = $1',
        [mainnetTrade.rows[0].id]
      );

      // Alfajores trade should be cancelled
      expect(alfajoresResult.rows[0].overall_status).to.equal('CANCELLED');
      expect(alfajoresResult.rows[0].leg1_state).to.equal('CANCELLED');

      // Mainnet trade should still be active (not processed)
      expect(mainnetResult.rows[0].overall_status).to.equal('IN_PROGRESS');
      expect(mainnetResult.rows[0].leg1_state).to.equal('CREATED');
    });
  });

  describe('Cross-Network Data Integrity', function() {
    it('should not find offers from other networks in filtered queries', async function() {
      // Create test account
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        ['0x1234567890123456789012345678901234567894', 'crossuser', 'cross@example.com']
      );
      const accountId = accountResult.rows[0].id;

      // Create offer on Alfajores
      await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [accountId, 'BUY', 100, 200, 500, 1.05, alfajoresNetwork.id]
      );

      // Query for offers on Mainnet (should find none)
      const mainnetOffers = await client.query(
        'SELECT * FROM offers WHERE network_id = $1',
        [mainnetNetwork.id]
      );

      expect(mainnetOffers.rows).to.have.length(0);
    });

    it('should maintain referential integrity within networks', async function() {
      // Create test account
      const accountResult = await client.query(
        'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
        ['0x1234567890123456789012345678901234567895', 'refuser', 'ref@example.com']
      );
      const accountId = accountResult.rows[0].id;

      // Create offer on Alfajores
      const offerResult = await client.query(
        'INSERT INTO offers (creator_account_id, offer_type, min_amount, max_amount, total_available_amount, rate_adjustment, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [accountId, 'BUY', 100, 200, 500, 1.05, alfajoresNetwork.id]
      );
      const offerId = offerResult.rows[0].id;

      // Create trade referencing the offer (same network)
      await client.query(
        `INSERT INTO trades (
          leg1_offer_id, overall_status, from_fiat_currency, destination_fiat_currency,
          leg1_state, leg1_seller_account_id, leg1_buyer_account_id,
          leg1_crypto_amount, leg1_fiat_currency, network_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [offerId, 'IN_PROGRESS', 'USD', 'USD', 'CREATED', accountId, accountId, 100, 'USD', alfajoresNetwork.id]
      );

      // Query should return the trade with proper offer reference
      const tradeQuery = await client.query(
        `SELECT t.*, o.offer_type 
         FROM trades t 
         JOIN offers o ON t.leg1_offer_id = o.id 
         WHERE t.network_id = $1 AND o.network_id = $1`,
        [alfajoresNetwork.id]
      );

      expect(tradeQuery.rows).to.have.length(1);
      expect(tradeQuery.rows[0].offer_type).to.equal('BUY');
    });
  });
});