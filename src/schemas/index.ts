/**
 * Barrel for all Zod schemas: primitives + per-domain request/response shapes.
 *
 * The schema directory is the single source of truth for API contract shapes.
 * Every route in the application validates its inputs and outputs through
 * schemas exported from here (or directly from sub-files).
 */

export * from './accounts';
export * from './admin';
export * from './escrows';
export * from './health';
export * from './offers';
export * from './primitives';
export * from './public';
export * from './trades';
export * from './transactions';
