import pool from '../db';

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
 * Queries trades for passed deadlines and cancels them.
 * Respects uncancelable states - will not cancel trades that are in FIAT_PAID, RELEASED, DISPUTED, or RESOLVED states.
 */
export async function expireDeadlines(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { deadlineField, stateField, cancelledAtField, allowedState } of configs) {
      const { rows } = await client.query(
        `SELECT id, ${deadlineField} AS deadline, ${stateField} AS current_state FROM trades
         WHERE overall_status = $1
           AND ${deadlineField} <= NOW()
           AND ${stateField} = $2
         FOR UPDATE SKIP LOCKED`,
        ['IN_PROGRESS', allowedState]
      );
      for (const { id, deadline, current_state } of rows) {
        // Check if the trade is in an uncancelable state (extra safety check)
        if (UNCANCELABLE_STATES.includes(current_state)) {
          console.log(
            `[AutoCancel] Skipping trade ${id}: '${deadlineField}' (${(deadline as Date).toISOString()}) passed but state=${current_state} is uncancelable.`
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
        // record audit of auto-cancel
        await client.query(
          'INSERT INTO trade_cancellations (trade_id, actor, deadline_field) VALUES ($1, $2, $3)',
          [id, 'system', deadlineField]
        );
        console.log(
          `[AutoCancel] Trade ${id}: '${deadlineField}' (${(deadline as Date).toISOString()}) passed; marking overall and ${stateField} CANCELLED.`
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[AutoCancel] expireDeadlines error:', error);
    throw error;
  } finally {
    client.release();
  }
}
