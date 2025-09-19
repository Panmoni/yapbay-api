import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

export async function query(text: string, params?: unknown[]) {
  let retries = 3; // Number of retries for transient errors
  let lastError: Error | unknown = null;

  while (retries > 0) {
    const client = await pool.connect();
    try {
      const res = await client.query(text, params);
      return res.rows;
    } catch (err) {
      lastError = err;
      // Check if this is a transient error that we should retry
      const isTransientError =
        (err as { code?: string }).code === 'ECONNRESET' ||
        (err as { code?: string }).code === '08006' || // Connection failure
        (err as { code?: string }).code === '08001' || // Unable to connect
        (err as { code?: string }).code === '57P01'; // Admin shutdown

      if (!isTransientError) {
        // Non-transient error, don't retry
        throw err;
      }

      retries--;
      if (retries > 0) {
        console.log(`[DB] Transient error, retrying... (${retries} attempts left)`);
        // Wait a bit before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, (3 - retries) * 200));
      }
    } finally {
      client.release();
    }
  }

  // If we get here, we've exhausted all retries
  console.error('[DB] All query retries failed:', lastError);
  throw lastError;
}

// Balance synchronization functions
export async function syncEscrowBalance(
  onchainEscrowId: string,
  contractBalance: string,
  reason?: string
) {
  const balanceInDecimal = parseFloat(contractBalance);
  await query(
    'UPDATE escrows SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2',
    [balanceInDecimal, onchainEscrowId]
  );

  if (reason) {
    console.log(
      `[DB] Synced balance for escrow ${onchainEscrowId}: ${contractBalance} USDC (${reason})`
    );
  }
}

export async function getEscrowsWithBalanceMismatch() {
  return await query(`
    SELECT 
      e.onchain_escrow_id,
      e.current_balance as db_balance,
      e.state,
      e.amount as original_amount
    FROM escrows e
    WHERE e.onchain_escrow_id IS NOT NULL
      AND e.state IN ('FUNDED', 'DISPUTED')
    ORDER BY e.created_at DESC
  `);
}

export async function recordBalanceValidation(
  onchainEscrowId: string,
  storedBalance: string,
  calculatedBalance: string,
  dbBalance: number
) {
  await query(
    `
    INSERT INTO contract_auto_cancellations (escrow_id, status, error_message)
    VALUES ($1, 'BALANCE_CHECK', $2)
  `,
    [
      parseInt(onchainEscrowId),
      JSON.stringify({
        stored_balance: storedBalance,
        calculated_balance: calculatedBalance,
        db_balance: dbBalance,
        timestamp: new Date().toISOString(),
      }),
    ]
  );
}

export default pool;

import { logError } from './logger'; // Assuming logger is set up

// Define types for the recordTransaction function
export type TransactionStatus = 'PENDING' | 'SUCCESS' | 'FAILED';
export type TransactionType =
  | 'CREATE_ESCROW'
  | 'FUND_ESCROW'
  | 'RELEASE_ESCROW'
  | 'CANCEL_ESCROW'
  | 'MARK_FIAT_PAID'
  | 'OPEN_DISPUTE'
  | 'RESPOND_DISPUTE'
  | 'RESOLVE_DISPUTE'
  | 'EVENT'
  | 'OTHER';

export interface TransactionData {
  transaction_hash?: string; // EVM transaction hash
  signature?: string; // Solana transaction signature
  status: TransactionStatus;
  type: TransactionType;
  block_number?: number | bigint | null; // EVM block number
  slot?: number | bigint | null; // Solana slot number
  sender_address?: string | null;
  receiver_or_contract_address?: string | null;
  gas_used?: number | bigint | null;
  error_message?: string | null;
  related_trade_id?: number | null;
  related_escrow_db_id?: number | null;
  network_id: number;
  network_family?: 'evm' | 'solana'; // Network family for multi-network support
}

/**
 * Records a blockchain transaction in the database.
 * Uses hybrid approach: ON CONFLICT for simple constraints, application logic for network-specific handling.
 * @param data - The transaction data to record.
 * @returns The ID of the inserted or existing transaction record, or null on failure.
 */
export const recordTransaction = async (data: TransactionData): Promise<number | null> => {
  const {
    transaction_hash,
    signature,
    status,
    type,
    block_number,
    slot,
    sender_address,
    receiver_or_contract_address,
    gas_used,
    error_message,
    related_trade_id,
    related_escrow_db_id,
    network_id,
    network_family = 'evm',
  } = data;

  // Convert BigInts to strings if necessary for DB insertion
  const blockNumberStr =
    block_number !== null && block_number !== undefined ? BigInt(block_number).toString() : null;
  const slotStr = slot !== null && slot !== undefined ? BigInt(slot).toString() : null;
  const gasUsedStr =
    gas_used !== null && gas_used !== undefined ? BigInt(gas_used).toString() : null;

  // Determine the unique identifier for this transaction
  const uniqueId = transaction_hash || signature;
  const uniqueIdField = transaction_hash ? 'transaction_hash' : 'signature';

  if (!uniqueId) {
    logError(
      'No transaction_hash or signature provided for transaction recording',
      new Error('Missing unique identifier')
    );
    return null;
  }

  // Single INSERT statement with ON CONFLICT that works with our simple constraints
  const sql = `
    INSERT INTO transactions (
      transaction_hash, signature, status, type, block_number, slot, sender_address,
      receiver_or_contract_address, gas_used, error_message,
      related_trade_id, related_escrow_db_id, network_id, network_family
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (${uniqueIdField}, network_id) DO UPDATE SET
      status = EXCLUDED.status,
      type = EXCLUDED.type,
      block_number = COALESCE(EXCLUDED.block_number, transactions.block_number),
      slot = COALESCE(EXCLUDED.slot, transactions.slot),
      sender_address = CASE 
        WHEN EXCLUDED.sender_address IS NOT NULL AND EXCLUDED.sender_address != '' 
        THEN EXCLUDED.sender_address 
        ELSE transactions.sender_address 
      END,
      receiver_or_contract_address = CASE 
        WHEN EXCLUDED.receiver_or_contract_address IS NOT NULL AND EXCLUDED.receiver_or_contract_address != '' 
        THEN EXCLUDED.receiver_or_contract_address 
        ELSE transactions.receiver_or_contract_address 
      END,
      gas_used = COALESCE(EXCLUDED.gas_used, transactions.gas_used),
      error_message = EXCLUDED.error_message,
      -- Preserve existing related IDs if they were already set
      related_trade_id = COALESCE(transactions.related_trade_id, EXCLUDED.related_trade_id),
      related_escrow_db_id = COALESCE(transactions.related_escrow_db_id, EXCLUDED.related_escrow_db_id)
    RETURNING id;
  `;

  const params = [
    transaction_hash,
    signature,
    status,
    type,
    blockNumberStr,
    slotStr,
    sender_address,
    receiver_or_contract_address,
    gasUsedStr,
    error_message,
    related_trade_id,
    related_escrow_db_id,
    network_id,
    network_family,
  ];

  try {
    const result = await query(sql, params);
    if (result.length > 0) {
      console.log(`[DB] Recorded/Updated transaction ${uniqueId} with ID: ${result[0].id}`);
      return result[0].id;
    }

    // If no result returned (shouldn't happen with RETURNING), fetch the ID
    const fetchResult = await query(
      `SELECT id FROM transactions WHERE ${uniqueIdField} = $1 AND network_id = $2`,
      [uniqueId, network_id]
    );

    if (fetchResult.length > 0) {
      console.log(`[DB] Fetched existing transaction ${uniqueId} with ID: ${fetchResult[0].id}`);
      return fetchResult[0].id;
    }

    logError(
      `Transaction ${uniqueId} recorded via ON CONFLICT but failed to return/fetch ID.`,
      new Error('Failed to retrieve ID after ON CONFLICT')
    );
    return null;
  } catch (err) {
    logError(`Failed to record transaction ${uniqueId}`, err as Error);

    // Attempt to fetch ID even on error, in case it was a conflict handled gracefully
    try {
      const fetchResult = await query(
        `SELECT id FROM transactions WHERE ${uniqueIdField} = $1 AND network_id = $2`,
        [uniqueId, network_id]
      );

      if (fetchResult.length > 0) {
        console.log(
          `[DB] Fetched existing transaction ${uniqueId} with ID: ${fetchResult[0].id} after recording error.`
        );
        return fetchResult[0].id;
      }

      return null; // Indicate failure
    } catch (fetchErr) {
      logError(
        `Failed to fetch transaction ID after recording error for ${uniqueId}`,
        fetchErr as Error
      );
      return null; // Indicate failure
    }
  }
};
