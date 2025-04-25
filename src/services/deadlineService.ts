import pool from '../db';

interface DeadlineConfig {
  deadlineField: string;
  stateField: string;
  cancelledAtField: string;
}

const configs: DeadlineConfig[] = [
  { deadlineField: 'leg1_escrow_deposit_deadline', stateField: 'leg1_state', cancelledAtField: 'leg1_cancelled_at' },
  { deadlineField: 'leg1_fiat_payment_deadline',  stateField: 'leg1_state', cancelledAtField: 'leg1_cancelled_at' },
  { deadlineField: 'leg2_escrow_deposit_deadline', stateField: 'leg2_state', cancelledAtField: 'leg2_cancelled_at' },
  { deadlineField: 'leg2_fiat_payment_deadline',  stateField: 'leg2_state', cancelledAtField: 'leg2_cancelled_at' }
];

/**
 * Queries trades for passed deadlines and cancels them.
 */
export async function expireDeadlines(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { deadlineField, stateField, cancelledAtField } of configs) {
      const { rows } = await client.query(
        `SELECT id, ${deadlineField} AS deadline FROM trades
         WHERE overall_status = 'IN_PROGRESS'
           AND ${deadlineField} <= NOW()
         FOR UPDATE SKIP LOCKED`
      );
      for (const { id, deadline } of rows) {
        await client.query(
          `UPDATE trades
             SET overall_status = 'CANCELLED',
                 ${stateField} = 'CANCELLED',
                 ${cancelledAtField} = NOW(),
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [id]
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
