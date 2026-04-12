/**
 * State enum primitives.
 *
 * Trade leg states and overall statuses are derived from
 * `src/utils/stateTransitions.ts` (single source of truth — adding a state
 * there automatically makes it valid here, removing one rejects it).
 *
 * Escrow and dispute states are hardcoded against `schema.sql` CHECK
 * constraints. Note: NEVER add a state here without also updating the
 * corresponding CHECK constraint in a migration; the schema-vs-DB drift
 * detection script (M5) will fail the build if they diverge.
 */

import { z } from 'zod';
import { VALID_LEG_TRANSITIONS, VALID_OVERALL_TRANSITIONS } from '../../utils/stateTransitions';

/**
 * Build a Zod enum from an object's keys.
 * Asserts the keys array is non-empty so Zod's enum signature is satisfied.
 */
function enumFromKeys<T extends Record<string, unknown>>(
  obj: T,
): z.ZodEnum<{ [K in keyof T & string]: K }> {
  const keys = Object.keys(obj) as [string, ...string[]];
  if (keys.length === 0) {
    throw new Error('Cannot build enum from empty object');
  }
  return z.enum(keys) as z.ZodEnum<{ [K in keyof T & string]: K }>;
}

/**
 * Trade leg state.
 *
 * Mirrors `trades.leg1_state` and `trades.leg2_state` CHECK constraints in
 * schema.sql, derived from `VALID_LEG_TRANSITIONS` keys.
 *
 * Schema CHECK: `('CREATED', 'FUNDED', 'FIAT_PAID', 'RELEASED', 'CANCELLED', 'DISPUTED', 'RESOLVED')`
 *
 * Note: `VALID_LEG_TRANSITIONS` also includes `COMPLETED` as a terminal state
 * that the application uses, even though it's not in the DB CHECK. The schema
 * accepts the wider set; the DB enforces the narrower set on writes.
 */
export const legStateEnum = enumFromKeys(VALID_LEG_TRANSITIONS);

/**
 * Trade overall status.
 *
 * Mirrors `trades.overall_status` CHECK in schema.sql, derived from
 * `VALID_OVERALL_TRANSITIONS` keys.
 *
 * Schema CHECK: `('IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED')`
 */
export const overallStatusEnum = enumFromKeys(VALID_OVERALL_TRANSITIONS);

/**
 * Escrow state.
 *
 * Mirrors `escrows.state` CHECK in schema.sql:
 * `('CREATED', 'FUNDED', 'RELEASED', 'CANCELLED', 'AUTO_CANCELLED', 'DISPUTED', 'RESOLVED')`
 */
export const escrowStateEnum = z.enum([
  'CREATED',
  'FUNDED',
  'RELEASED',
  'CANCELLED',
  'AUTO_CANCELLED',
  'DISPUTED',
  'RESOLVED',
]);

/**
 * Dispute status.
 *
 * Mirrors `disputes.status` CHECK in schema.sql:
 * `('OPENED', 'RESPONDED', 'RESOLVED', 'DEFAULTED')`
 */
export const disputeStatusEnum = z.enum(['OPENED', 'RESPONDED', 'RESOLVED', 'DEFAULTED']);
