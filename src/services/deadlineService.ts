import pool from '../db';
import { NetworkService } from './networkService';

interface DeadlineConfig {
  deadlineField: string;
  stateField: string;
  cancelledAtField: string;
  allowedState: string;
}

// States where a trade should not be auto-cancelled, regardless of deadline
const UNCANCELABLE_STATES = ['FIAT_PAID', 'RELEASED', 'DISPUTED', 'RESOLVED'];

const configs: DeadlineConfig[] = [
  { deadlineField: 'leg1_escrow_deposit_deadline', stateField: 'leg1_state', cancelledAtField: 'leg1_cancelled_at', allowedState: 'CREATED' },
  { deadlineField: 'leg1_fiat_payment_deadline',  stateField: 'leg1_state', cancelledAtField: 'leg1_cancelled_at', allowedState: 'FUNDED' },
  { deadlineField: 'leg2_escrow_deposit_deadline', stateField: 'leg2_state', cancelledAtField: 'leg2_cancelled_at', allowedState: 'CREATED' },
  { deadlineField: 'leg2_fiat_payment_deadline',  stateField: 'leg2_state', cancelledAtField: 'leg2_cancelled_at', allowedState: 'FUNDED' }
];

/**
 * Main function that processes deadlines for all active networks.
 * This is the function that should be called by the cron job.
 */
export async function expireDeadlines(): Promise<void> {
  try {
    const activeNetworks = await NetworkService.getActiveNetworks();
    
    if (activeNetworks.length === 0) {
      console.log('[AutoCancel] No active networks found, skipping deadline processing');
      return;
    }

    console.log(`[AutoCancel] Processing deadlines for ${activeNetworks.length} networks`);
    
    for (const network of activeNetworks) {
      try {
        await expireDeadlinesForNetwork(network.id);
        console.log(`[AutoCancel] Completed deadline processing for network ${network.name} (ID: ${network.id})`);
      } catch (error) {
        console.error(`[AutoCancel] Failed to process deadlines for network ${network.name} (ID: ${network.id}):`, error);
        // Continue processing other networks even if one fails
      }
    }
    
    console.log('[AutoCancel] Completed deadline processing for all networks');
  } catch (error) {
    console.error('[AutoCancel] Error getting active networks:', error);
    throw error;
  }
}

/**
 * Queries trades for passed deadlines and cancels them for a specific network.
 * Respects uncancelable states - will not cancel trades that are in FIAT_PAID, RELEASED, DISPUTED, or RESOLVED states.
 */
export async function expireDeadlinesForNetwork(networkId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    let totalCancelled = 0;
    
    for (const { deadlineField, stateField, cancelledAtField, allowedState } of configs) {
      const { rows } = await client.query(
        `SELECT id, ${deadlineField} AS deadline, ${stateField} AS current_state FROM trades
         WHERE overall_status = $1
           AND ${deadlineField} <= NOW()
           AND ${stateField} = $2
           AND network_id = $3
         FOR UPDATE SKIP LOCKED`,
        ['IN_PROGRESS', allowedState, networkId]
      );
      
      for (const { id, deadline, current_state } of rows) {
        // Check if the trade is in an uncancelable state (extra safety check)
        if (UNCANCELABLE_STATES.includes(current_state)) {
          console.log(
            `[AutoCancel] Network ${networkId} - Skipping trade ${id}: '${deadlineField}' (${(deadline as Date).toISOString()}) passed but state=${current_state} is uncancelable.`
          );
          continue;
        }

        await client.query(
          `UPDATE trades
             SET overall_status = 'CANCELLED',
                 ${stateField} = 'CANCELLED',
                 ${cancelledAtField} = NOW(),
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [id]
        );
        
        // record audit of auto-cancel with network context
        await client.query(
          'INSERT INTO trade_cancellations (trade_id, actor, deadline_field, network_id) VALUES ($1, $2, $3, $4)',
          [id, 'system', deadlineField, networkId]
        );
        
        totalCancelled++;
        console.log(
          `[AutoCancel] Network ${networkId} - Trade ${id}: '${deadlineField}' (${(deadline as Date).toISOString()}) passed; marking overall and ${stateField} CANCELLED.`
        );
      }
    }
    
    await client.query('COMMIT');
    
    if (totalCancelled > 0) {
      console.log(`[AutoCancel] Network ${networkId} - Cancelled ${totalCancelled} expired trades`);
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[AutoCancel] expireDeadlinesForNetwork ${networkId} error:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Legacy function for backward compatibility.
 * @deprecated Use expireDeadlines() instead, which processes all networks.
 */
export async function expireDeadlinesLegacy(): Promise<void> {
  console.warn('[AutoCancel] WARNING: Using legacy single-network deadline processing. Consider updating to multi-network version.');
  
  try {
    const defaultNetwork = await NetworkService.getDefaultNetwork();
    await expireDeadlinesForNetwork(defaultNetwork.id);
  } catch (error) {
    console.error('[AutoCancel] Legacy deadline processing error:', error);
    throw error;
  }
}

/**
 * Get statistics about upcoming deadlines for a specific network
 */
export async function getDeadlineStats(networkId: number): Promise<{
  upcomingIn1Hour: number;
  upcomingIn24Hours: number;
  overdue: number;
}> {
  const client = await pool.connect();
  try {
    const stats = {
      upcomingIn1Hour: 0,
      upcomingIn24Hours: 0,
      overdue: 0
    };

    for (const { deadlineField, stateField, allowedState } of configs) {
      // Count deadlines in next hour
      const { rows: hourRows } = await client.query(
        `SELECT COUNT(*) as count FROM trades
         WHERE overall_status = 'IN_PROGRESS'
           AND ${stateField} = $1
           AND network_id = $2
           AND ${deadlineField} BETWEEN NOW() AND NOW() + INTERVAL '1 hour'`,
        [allowedState, networkId]
      );
      
      // Count deadlines in next 24 hours
      const { rows: dayRows } = await client.query(
        `SELECT COUNT(*) as count FROM trades
         WHERE overall_status = 'IN_PROGRESS'
           AND ${stateField} = $1
           AND network_id = $2
           AND ${deadlineField} BETWEEN NOW() AND NOW() + INTERVAL '24 hours'`,
        [allowedState, networkId]
      );
      
      // Count overdue deadlines
      const { rows: overdueRows } = await client.query(
        `SELECT COUNT(*) as count FROM trades
         WHERE overall_status = 'IN_PROGRESS'
           AND ${stateField} = $1
           AND network_id = $2
           AND ${deadlineField} < NOW()`,
        [allowedState, networkId]
      );

      stats.upcomingIn1Hour += parseInt(hourRows[0].count);
      stats.upcomingIn24Hours += parseInt(dayRows[0].count);
      stats.overdue += parseInt(overdueRows[0].count);
    }

    return stats;
  } finally {
    client.release();
  }
}

/**
 * Get deadline statistics for all active networks
 */
export async function getAllNetworksDeadlineStats(): Promise<{
  [networkId: number]: {
    networkName: string;
    upcomingIn1Hour: number;
    upcomingIn24Hours: number;
    overdue: number;
  }
}> {
  const activeNetworks = await NetworkService.getActiveNetworks();
  const allStats: {
    [networkId: number]: {
      networkName: string;
      upcomingIn1Hour: number;
      upcomingIn24Hours: number;
      overdue: number;
    }
  } = {};

  for (const network of activeNetworks) {
    const stats = await getDeadlineStats(network.id);
    allStats[network.id] = {
      networkName: network.name,
      ...stats
    };
  }

  return allStats;
}