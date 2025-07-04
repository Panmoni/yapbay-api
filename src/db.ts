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
        (err as { code?: string }).code === '08006' ||  // Connection failure
        (err as { code?: string }).code === '08001' ||  // Unable to connect
        (err as { code?: string }).code === '57P01';    // Admin shutdown
      
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
export async function syncEscrowBalance(onchainEscrowId: string, contractBalance: string, reason?: string) {
  const balanceInDecimal = parseFloat(contractBalance);
  await query(
    'UPDATE escrows SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2',
    [balanceInDecimal, onchainEscrowId]
  );
  
  if (reason) {
    console.log(`[DB] Synced balance for escrow ${onchainEscrowId}: ${contractBalance} USDC (${reason})`);
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

export async function recordBalanceValidation(onchainEscrowId: string, storedBalance: string, calculatedBalance: string, dbBalance: number) {
  await query(`
    INSERT INTO contract_auto_cancellations (escrow_id, status, error_message)
    VALUES ($1, 'BALANCE_CHECK', $2)
  `, [
    parseInt(onchainEscrowId),
    JSON.stringify({
      stored_balance: storedBalance,
      calculated_balance: calculatedBalance,
      db_balance: dbBalance,
      timestamp: new Date().toISOString()
    })
  ]);
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
  transaction_hash: string;
  status: TransactionStatus;
  type: TransactionType;
  block_number?: number | bigint | null;
  sender_address?: string | null;
  receiver_or_contract_address?: string | null;
  gas_used?: number | bigint | null;
  error_message?: string | null;
  related_trade_id?: number | null;
  related_escrow_db_id?: number | null;
  network_id: number;
}

/**
 * Records a blockchain transaction in the database.
 * Handles potential duplicate transaction_hash errors gracefully using ON CONFLICT.
 * @param data - The transaction data to record.
 * @returns The ID of the inserted or existing transaction record, or null on failure.
 */
export const recordTransaction = async (data: TransactionData): Promise<number | null> => {
  const {
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
    network_id,
  } = data;

  // Convert BigInts to strings if necessary for DB insertion
  const blockNumberStr =
    block_number !== null && block_number !== undefined ? BigInt(block_number).toString() : null;
  const gasUsedStr =
    gas_used !== null && gas_used !== undefined ? BigInt(gas_used).toString() : null;

  const sql = `
    INSERT INTO transactions (
      transaction_hash, status, type, block_number, sender_address,
      receiver_or_contract_address, gas_used, error_message,
      related_trade_id, related_escrow_db_id, network_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (transaction_hash, network_id) DO UPDATE SET
      status = EXCLUDED.status,
      block_number = EXCLUDED.block_number,
      gas_used = EXCLUDED.gas_used,
      error_message = EXCLUDED.error_message,
      -- Avoid updating related IDs if they were already set by an earlier PENDING record
      related_trade_id = COALESCE(transactions.related_trade_id, EXCLUDED.related_trade_id),
      related_escrow_db_id = COALESCE(transactions.related_escrow_db_id, EXCLUDED.related_escrow_db_id)
    RETURNING id;
  `;

  const params = [
    transaction_hash,
    status,
    type,
    blockNumberStr,
    sender_address,
    receiver_or_contract_address,
    gasUsedStr,
    error_message,
    related_trade_id,
    related_escrow_db_id,
    network_id,
  ];

  try {
    const result = await query(sql, params);
    if (result.length > 0) {
      console.log(`[DB] Recorded/Updated transaction ${transaction_hash} with ID: ${result[0].id}`);
      return result[0].id;
    }
    // If ON CONFLICT DO UPDATE happened but didn't return ID (less common)
    // Try fetching the ID based on the hash
    const fetchResult = await query('SELECT id FROM transactions WHERE transaction_hash = $1 AND network_id = $2', [
      transaction_hash,
      network_id,
    ]);
    if (fetchResult.length > 0) {
      console.log(
        `[DB] Fetched existing transaction ${transaction_hash} with ID: ${fetchResult[0].id} after ON CONFLICT`
      );
      return fetchResult[0].id;
    }
    logError(
      `Transaction ${transaction_hash} recorded via ON CONFLICT but failed to return/fetch ID.`,
      new Error('Failed to retrieve ID after ON CONFLICT')
    );
    return null;
  } catch (err) {
    logError(`Failed to record transaction ${transaction_hash}`, err as Error);
    // Attempt to fetch ID even on error, in case it was a conflict handled gracefully
    try {
      const fetchResult = await query('SELECT id FROM transactions WHERE transaction_hash = $1', [
        transaction_hash,
      ]);
      if (fetchResult.length > 0) {
        console.log(
          `[DB] Fetched existing transaction ${transaction_hash} with ID: ${fetchResult[0].id} after recording error.`
        );
        return fetchResult[0].id;
      }
      return null; // Indicate failure
    } catch (fetchErr) {
      logError(
        `Failed to fetch transaction ID after recording error for ${transaction_hash}`,
        fetchErr as Error
      );
      return null; // Indicate failure
    }
  }
};
