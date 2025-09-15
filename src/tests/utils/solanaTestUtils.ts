import { Pool } from 'pg';
import { NetworkFamily } from '../../types/networks';

/**
 * Solana Test Utilities
 *
 * This module provides reusable utilities for Solana-related tests,
 * focusing on database operations and mock data generation without
 * requiring real blockchain connections.
 */

export interface TestAccount {
  id: number;
  wallet_address: string;
  username: string;
  email: string;
}

export interface TestOffer {
  id: number;
  creator_account_id: number;
  network_id: number;
  offer_type: 'BUY' | 'SELL';
  token: string;
  fiat_currency: string;
  min_amount: number;
  max_amount: number;
  total_available_amount: number;
  rate_adjustment: number;
  terms: string;
}

export interface TestTrade {
  id: number;
  leg1_offer_id: number;
  network_id: number;
  overall_status: string;
  from_fiat_currency: string;
  destination_fiat_currency: string;
  leg1_state: string;
  leg1_seller_account_id: number;
  leg1_buyer_account_id: number;
  leg1_crypto_token: string;
  leg1_crypto_amount: number;
  leg1_fiat_amount: number;
  leg1_fiat_currency: string;
}

export interface TestEscrow {
  id: number;
  trade_id: number;
  network_id: number;
  escrow_address: string;
  seller_address: string;
  buyer_address: string;
  arbitrator_address: string;
  token_type: string;
  amount: number;
  state: string;
  sequential: boolean;
  network_family: string;
  program_id: string;
  escrow_pda: string;
  escrow_token_account: string;
}

export interface TestTransaction {
  id: number;
  transaction_hash: string;
  status: string;
  type: string;
  block_number?: number;
  sender_address?: string;
  receiver_or_contract_address?: string;
  gas_used?: number;
  error_message?: string;
  related_trade_id?: number;
  related_escrow_db_id?: number;
}

/**
 * Generate a unique test address (44 characters to match Solana format)
 * Simple string generation for database testing purposes
 */
export function generateSolanaAddress(timestamp?: number, index?: number): string {
  const ts = timestamp || Date.now();
  const idx = index || 0;
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const base = `test_addr_${ts}_${idx}_${randomSuffix}`.padEnd(44, '0');
  return base.substring(0, 44);
}

/**
 * Generate a unique test transaction hash (66 characters to match database schema)
 * Simple string generation for database testing purposes
 */
export function generateSolanaSignature(timestamp?: number, index?: number): string {
  const ts = timestamp || Date.now();
  const idx = index || 0;
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const base = `test_tx_${ts}_${idx}_${randomSuffix}`.padEnd(66, '0');
  return base.substring(0, 66);
}

/**
 * Generate a unique username for testing
 */
export function generateTestUsername(prefix: string = 'testuser'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Generate a unique email for testing
 */
export function generateTestEmail(prefix: string = 'test'): string {
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${Date.now()}_${randomSuffix}@example.com`;
}

/**
 * Create a test account in the database
 */
export async function createTestAccount(
  client: Pool,
  options: {
    wallet_address?: string;
    username?: string;
    email?: string;
  } = {}
): Promise<TestAccount> {
  const wallet_address = options.wallet_address || generateSolanaAddress();
  const username = options.username || generateTestUsername();
  const email = options.email || generateTestEmail();

  const result = await client.query(
    'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING *',
    [wallet_address, username, email]
  );

  return result.rows[0];
}

/**
 * Create a test offer in the database
 */
export async function createTestOffer(
  client: Pool,
  options: {
    creator_account_id: number;
    network_id: number;
    offer_type?: 'BUY' | 'SELL';
    token?: string;
    fiat_currency?: string;
    min_amount?: number;
    max_amount?: number;
    total_available_amount?: number;
    rate_adjustment?: number;
    terms?: string;
  }
): Promise<TestOffer> {
  const {
    creator_account_id,
    network_id,
    offer_type = 'SELL',
    token = 'USDC',
    fiat_currency = 'USD',
    min_amount = 50.0,
    max_amount = 100.0,
    total_available_amount = 100.0,
    rate_adjustment = 0.0,
    terms = 'Test offer for Solana network',
  } = options;

  const result = await client.query(
    `INSERT INTO offers (
      creator_account_id, network_id, offer_type, token, fiat_currency,
      min_amount, max_amount, total_available_amount, rate_adjustment, terms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      creator_account_id,
      network_id,
      offer_type,
      token,
      fiat_currency,
      min_amount,
      max_amount,
      total_available_amount,
      rate_adjustment,
      terms,
    ]
  );

  return result.rows[0];
}

/**
 * Create a test trade in the database
 */
export async function createTestTrade(
  client: Pool,
  options: {
    leg1_offer_id: number;
    network_id: number;
    leg1_seller_account_id: number;
    leg1_buyer_account_id: number;
    overall_status?: string;
    from_fiat_currency?: string;
    destination_fiat_currency?: string;
    leg1_state?: string;
    leg1_crypto_token?: string;
    leg1_crypto_amount?: number;
    leg1_fiat_amount?: number;
    leg1_fiat_currency?: string;
  }
): Promise<TestTrade> {
  const {
    leg1_offer_id,
    network_id,
    leg1_seller_account_id,
    leg1_buyer_account_id,
    overall_status = 'IN_PROGRESS',
    from_fiat_currency = 'USD',
    destination_fiat_currency = 'USD',
    leg1_state = 'CREATED',
    leg1_crypto_token = 'USDC',
    leg1_crypto_amount = 100.0,
    leg1_fiat_amount = 100.0,
    leg1_fiat_currency = 'USD',
  } = options;

  const result = await client.query(
    `INSERT INTO trades (
      leg1_offer_id, network_id, overall_status, from_fiat_currency, destination_fiat_currency,
      leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_token,
      leg1_crypto_amount, leg1_fiat_amount, leg1_fiat_currency
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      leg1_offer_id,
      network_id,
      overall_status,
      from_fiat_currency,
      destination_fiat_currency,
      leg1_state,
      leg1_seller_account_id,
      leg1_buyer_account_id,
      leg1_crypto_token,
      leg1_crypto_amount,
      leg1_fiat_amount,
      leg1_fiat_currency,
    ]
  );

  return result.rows[0];
}

/**
 * Create a test escrow in the database
 */
export async function createTestEscrow(
  client: Pool,
  options: {
    trade_id: number;
    network_id: number;
    escrow_address?: string;
    seller_address?: string;
    buyer_address?: string;
    arbitrator_address?: string;
    token_type?: string;
    amount?: number;
    state?: string;
    sequential?: boolean;
    network_family?: string;
    program_id?: string;
    escrow_pda?: string;
    escrow_token_account?: string;
  }
): Promise<TestEscrow> {
  const {
    trade_id,
    network_id,
    escrow_address = generateSolanaAddress(),
    seller_address = generateSolanaAddress(Date.now(), 1),
    buyer_address = generateSolanaAddress(Date.now(), 2),
    arbitrator_address = generateSolanaAddress(Date.now(), 3),
    token_type = 'USDC',
    amount = 100.0,
    state = 'CREATED',
    sequential = false,
    network_family = 'solana',
    program_id = '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
    escrow_pda = generateSolanaAddress(Date.now(), 4),
    escrow_token_account = generateSolanaAddress(Date.now(), 5),
  } = options;

  const result = await client.query(
    `INSERT INTO escrows (
      trade_id, network_id, escrow_address, seller_address, buyer_address,
      arbitrator_address, token_type, amount, state, sequential, network_family,
      program_id, escrow_pda, escrow_token_account
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [
      trade_id,
      network_id,
      escrow_address,
      seller_address,
      buyer_address,
      arbitrator_address,
      token_type,
      amount,
      state,
      sequential,
      network_family,
      program_id,
      escrow_pda,
      escrow_token_account,
    ]
  );

  return result.rows[0];
}

/**
 * Create a test transaction in the database
 */
export async function createTestTransaction(
  client: Pool,
  options: {
    network_id?: number;
    transaction_hash?: string;
    status?: string;
    type?: string;
    block_number?: number;
    sender_address?: string;
    receiver_or_contract_address?: string;
    gas_used?: number;
    error_message?: string;
    related_trade_id?: number;
    related_escrow_db_id?: number;
  }
): Promise<TestTransaction> {
  const {
    network_id = 1, // Add default network_id
    transaction_hash = generateSolanaSignature().substring(0, 66), // Ensure 66 chars max
    status = 'SUCCESS',
    type = 'CREATE_ESCROW',
    block_number = Math.floor(Date.now() / 1000),
    sender_address = generateSolanaAddress(Date.now(), 1),
    receiver_or_contract_address = generateSolanaAddress(Date.now(), 2),
    gas_used = 5000,
    error_message = null,
    related_trade_id = null,
    related_escrow_db_id = null,
  } = options;

  const result = await client.query(
    `INSERT INTO transactions (
      network_id, transaction_hash, status, type, block_number, sender_address,
      receiver_or_contract_address, gas_used, error_message, related_trade_id, related_escrow_db_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      network_id,
      transaction_hash,
      status,
      type,
      block_number,
      sender_address,
      receiver_or_contract_address,
      gas_used,
      error_message,
      related_trade_id,
      related_escrow_db_id,
    ]
  );

  return result.rows[0];
}

/**
 * Create a complete test scenario with account, offer, trade, and escrow
 */
export async function createCompleteTestScenario(
  client: Pool,
  networkId: number,
  options: {
    sellerAccount?: Partial<TestAccount>;
    buyerAccount?: Partial<TestAccount>;
    offer?: Partial<TestOffer>;
    trade?: Partial<TestTrade>;
    escrow?: Partial<TestEscrow>;
  } = {}
): Promise<{
  sellerAccount: TestAccount;
  buyerAccount: TestAccount;
  offer: TestOffer;
  trade: TestTrade;
  escrow: TestEscrow;
}> {
  // Create seller account
  const sellerAccount = await createTestAccount(client, {
    username: 'seller',
    ...options.sellerAccount,
  });

  // Create buyer account
  const buyerAccount = await createTestAccount(client, {
    username: 'buyer',
    ...options.buyerAccount,
  });

  // Create offer
  const offer = await createTestOffer(client, {
    creator_account_id: sellerAccount.id,
    network_id: networkId,
    ...options.offer,
  });

  // Create trade
  const trade = await createTestTrade(client, {
    leg1_offer_id: offer.id,
    network_id: networkId,
    leg1_seller_account_id: sellerAccount.id,
    leg1_buyer_account_id: buyerAccount.id,
    ...options.trade,
  });

  // Create escrow
  const escrow = await createTestEscrow(client, {
    trade_id: trade.id,
    network_id: networkId,
    seller_address: sellerAccount.wallet_address,
    buyer_address: buyerAccount.wallet_address,
    ...options.escrow,
  });

  return {
    sellerAccount,
    buyerAccount,
    offer,
    trade,
    escrow,
  };
}

/**
 * Clean up test data by ID
 */
export async function cleanupTestData(
  client: Pool,
  ids: {
    accountIds?: number[];
    offerIds?: number[];
    tradeIds?: number[];
    escrowIds?: number[];
    transactionIds?: number[];
  }
): Promise<void> {
  const { accountIds, offerIds, tradeIds, escrowIds, transactionIds } = ids;

  // Clean up in reverse order to respect foreign key constraints
  if (transactionIds && transactionIds.length > 0) {
    await client.query('DELETE FROM transactions WHERE id = ANY($1)', [transactionIds]);
  }

  if (escrowIds && escrowIds.length > 0) {
    await client.query('DELETE FROM escrows WHERE id = ANY($1)', [escrowIds]);
  }

  if (tradeIds && tradeIds.length > 0) {
    await client.query('DELETE FROM trades WHERE id = ANY($1)', [tradeIds]);
  }

  if (offerIds && offerIds.length > 0) {
    await client.query('DELETE FROM offers WHERE id = ANY($1)', [offerIds]);
  }

  if (accountIds && accountIds.length > 0) {
    await client.query('DELETE FROM accounts WHERE id = ANY($1)', [accountIds]);
  }
}

/**
 * Clean up test data by network ID (useful for network isolation tests)
 */
export async function cleanupTestDataByNetwork(client: Pool, networkId: number): Promise<void> {
  // Get all test data for this network
  const transactions = await client.query('SELECT id FROM transactions WHERE network_id = $1', [
    networkId,
  ]);
  const escrows = await client.query('SELECT id FROM escrows WHERE network_id = $1', [networkId]);
  const trades = await client.query('SELECT id FROM trades WHERE network_id = $1', [networkId]);
  const offers = await client.query('SELECT id FROM offers WHERE network_id = $1', [networkId]);

  // Clean up in reverse order
  if (transactions.rows.length > 0) {
    await client.query('DELETE FROM transactions WHERE network_id = $1', [networkId]);
  }

  if (escrows.rows.length > 0) {
    await client.query('DELETE FROM escrows WHERE network_id = $1', [networkId]);
  }

  if (trades.rows.length > 0) {
    await client.query('DELETE FROM trades WHERE network_id = $1', [networkId]);
  }

  if (offers.rows.length > 0) {
    await client.query('DELETE FROM offers WHERE network_id = $1', [networkId]);
  }
}

/**
 * Mock Solana network configuration for testing
 */
export function createMockSolanaNetwork(
  id: number,
  name: string = 'solana-devnet',
  isActive: boolean = true
): any {
  return {
    id,
    name,
    chainId: id === 1 ? 103 : 101, // Mock chain IDs
    rpcUrl: `https://api.devnet.solana.com`,
    wsUrl: `wss://api.devnet.solana.com`,
    contractAddress: null,
    programId: '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
    usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    arbitratorAddress: generateSolanaAddress(),
    isTestnet: name.includes('devnet'),
    isActive,
    networkFamily: NetworkFamily.SOLANA,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Simple validation for test addresses (just check length)
 */
export function isValidTestAddress(address: string): boolean {
  return address.length === 44;
}

/**
 * Simple validation for test transaction hashes (just check length)
 */
export function isValidTestSignature(signature: string): boolean {
  return signature.length === 66;
}

/**
 * Generate a mock Solana transaction response
 */
export function createMockSolanaTransactionResponse(
  signature: string = generateSolanaSignature(),
  slot: number = Math.floor(Date.now() / 1000)
): any {
  return {
    signature,
    slot,
    blockTime: Math.floor(Date.now() / 1000),
    confirmationStatus: 'confirmed',
    err: null,
    meta: {
      fee: 5000,
      preBalances: [1000000000, 0],
      postBalances: [999995000, 5000],
      innerInstructions: [],
      logMessages: [
        'Program 11111111111111111111111111111112 invoke [1]',
        'Program 11111111111111111111111111111112 success',
      ],
    },
  };
}

/**
 * Generate a mock Solana account info response
 */
export function createMockSolanaAccountInfo(
  address: string = generateSolanaAddress(),
  lamports: number = 1000000000
): any {
  return {
    executable: false,
    owner: generateSolanaAddress(Date.now(), 99), // Generate a proper 44-char address
    lamports,
    data: Buffer.from(''),
    rentEpoch: 0,
  };
}
