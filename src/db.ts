import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows;
  } finally {
    client.release();
  }
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
      related_trade_id, related_escrow_db_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (transaction_hash) DO UPDATE SET
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
  ];

  try {
    const result = await query(sql, params);
    if (result.length > 0) {
      console.log(`[DB] Recorded/Updated transaction ${transaction_hash} with ID: ${result[0].id}`);
      return result[0].id;
    }
    // If ON CONFLICT DO UPDATE happened but didn't return ID (less common)
    // Try fetching the ID based on the hash
    const fetchResult = await query('SELECT id FROM transactions WHERE transaction_hash = $1', [
      transaction_hash,
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
