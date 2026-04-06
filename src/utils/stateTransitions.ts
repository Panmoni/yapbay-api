/**
 * Single source of truth for valid state transitions.
 * Used by both validation middleware and state-update execution.
 */

/** Valid transitions for trade leg states (leg1_state, leg2_state) */
export const VALID_LEG_TRANSITIONS: Record<string, string[]> = {
  'CREATED': ['FUNDED', 'CANCELLED'],
  'FUNDED': ['FIAT_PAID', 'CANCELLED', 'DISPUTED'],
  'FIAT_PAID': ['RELEASED', 'CANCELLED', 'DISPUTED'],
  'RELEASED': ['COMPLETED'],
  'CANCELLED': [],
  'DISPUTED': ['RESOLVED', 'RELEASED', 'CANCELLED'],
  'RESOLVED': ['COMPLETED'],
  'COMPLETED': [],
};

/** Valid transitions for trade overall_status */
export const VALID_OVERALL_TRANSITIONS: Record<string, string[]> = {
  'IN_PROGRESS': ['COMPLETED', 'CANCELLED', 'DISPUTED'],
  'DISPUTED': ['COMPLETED', 'CANCELLED'],
  'COMPLETED': [],
  'CANCELLED': [],
};
