import { Pool, type PoolClient } from 'pg';
import { env } from './config/env';
import { decimalMath as _decimalMath } from './utils/decimalMath';

const pool = new Pool({
  connectionString: env.POSTGRES_URL,
  max: env.DB_POOL_MAX,
  min: env.DB_POOL_MIN,
  idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS,
  query_timeout: env.DB_QUERY_TIMEOUT_MS,
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on('error', (err) => {
  // Silent pool errors otherwise end up as unhandled 'error' events on the
  // Pool, which Node will re-emit as process 'uncaughtException'. Logging
  // here keeps them visible without crashing the process.
  console.error('[DB] Idle client error:', err);
});

/**
 * Pre-warm the pool by opening `min` connections in parallel and releasing
 * them, so first-request latency doesn't include connection setup. Called
 * from server.ts startup after the initial connection check.
 */
export async function warmPool(): Promise<void> {
  const targetConnections = Math.max(env.DB_POOL_MIN, 1);
  const results = await Promise.allSettled(
    Array.from({ length: targetConnections }, () => pool.connect()),
  );
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      result.value.release();
    } else {
      failures.push(result.reason);
    }
  }
  if (failures.length > 0) {
    const first = failures[0];
    throw first instanceof Error
      ? first
      : new Error(`warmPool: ${failures.length} connection(s) failed`);
  }
}

/**
 * Execute a callback within a database transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK.
 * The callback receives a PoolClient that must be used for all queries within the transaction.
 */
export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Re-export decimalMath so existing call sites `import { decimalMath } from '../db'`
// keep working. Implementation lives in a side-effect-free module under
// src/utils/ so it can be imported from tests and scripts without bringing
// up the full DB pool.
export { decimalMath } from './utils/decimalMath';

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
        await new Promise((resolve) => setTimeout(resolve, (3 - retries) * 200));
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
  reason?: string,
) {
  const balanceInDecimal = _decimalMath.parse(contractBalance);
  if (balanceInDecimal === null) {
    console.error(`[DB] Invalid balance value for escrow ${onchainEscrowId}: ${contractBalance}`);
    return;
  }
  await query(
    'UPDATE escrows SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2',
    [balanceInDecimal, onchainEscrowId],
  );

  if (reason) {
    console.log(
      `[DB] Synced balance for escrow ${onchainEscrowId}: ${contractBalance} USDC (${reason})`,
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
  dbBalance: number,
) {
  await query(
    `
    INSERT INTO contract_auto_cancellations (escrow_id, status, error_message)
    VALUES ($1, 'BALANCE_CHECK', $2)
  `,
    [
      Number.parseInt(onchainEscrowId, 10),
      JSON.stringify({
        stored_balance: storedBalance,
        calculated_balance: calculatedBalance,
        db_balance: dbBalance,
        timestamp: new Date().toISOString(),
      }),
    ],
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
  block_number?: number | bigint | null; // EVM block number
  error_message?: string | null;
  gas_used?: number | bigint | null;
  network_family?: 'evm' | 'solana'; // Network family for multi-network support
  network_id: number;
  receiver_or_contract_address?: string | null;
  related_escrow_db_id?: number | null;
  related_trade_id?: number | null;
  sender_address?: string | null;
  signature?: string; // Solana transaction signature
  slot?: number | bigint | null; // Solana slot number
  status: TransactionStatus;
  transaction_hash?: string; // EVM transaction hash
  type: TransactionType;
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
      new Error('Missing unique identifier'),
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
      [uniqueId, network_id],
    );

    if (fetchResult.length > 0) {
      console.log(`[DB] Fetched existing transaction ${uniqueId} with ID: ${fetchResult[0].id}`);
      return fetchResult[0].id;
    }

    logError(
      `Transaction ${uniqueId} recorded via ON CONFLICT but failed to return/fetch ID.`,
      new Error('Failed to retrieve ID after ON CONFLICT'),
    );
    return null;
  } catch (err) {
    logError(`Failed to record transaction ${uniqueId}`, err as Error);

    // Attempt to fetch ID even on error, in case it was a conflict handled gracefully
    try {
      const fetchResult = await query(
        `SELECT id FROM transactions WHERE ${uniqueIdField} = $1 AND network_id = $2`,
        [uniqueId, network_id],
      );

      if (fetchResult.length > 0) {
        console.log(
          `[DB] Fetched existing transaction ${uniqueId} with ID: ${fetchResult[0].id} after recording error.`,
        );
        return fetchResult[0].id;
      }

      return null; // Indicate failure
    } catch (fetchErr) {
      logError(
        `Failed to fetch transaction ID after recording error for ${uniqueId}`,
        fetchErr as Error,
      );
      return null; // Indicate failure
    }
  }
};
