/**
 * Map PostgreSQL driver errors onto structured HTTP responses.
 *
 * Used by the global error handler and the `withErrorHandling` wrapper to turn
 * constraint violations into 4xx/409 responses with usable fields instead of
 * generic 500s. We deliberately do NOT echo `err.detail` or `err.message` into
 * the response — those often leak schema internals (column values, constraint
 * names) — and only surface a small, whitelisted shape.
 */

export interface PgErrorMapping {
  code: string;
  fields?: string[];
  message: string;
  retryAfter?: number;
  status: number;
}

interface PgErrorLike {
  code?: string;
  column?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

export function isPgError(err: unknown): err is PgErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as PgErrorLike).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((err as PgErrorLike).code ?? '')
  );
}

/**
 * Extract a column name from the `detail` string of common PG errors.
 * Examples:
 *   Key (email)=(foo@bar) already exists.                 -> "email"
 *   Key (user_id)=(42) is not present in table "users".   -> "user_id"
 *   null value in column "amount" of relation "..."       -> "amount"
 */
function extractColumn(err: PgErrorLike): string | undefined {
  if (err.column) {
    return err.column;
  }
  const detail = err.detail ?? '';
  const keyMatch = detail.match(/^Key \(([^)]+)\)=/);
  if (keyMatch?.[1]) {
    return keyMatch[1].split(',')[0]?.trim();
  }
  const nullMatch = detail.match(/null value in column "([^"]+)"/);
  if (nullMatch?.[1]) {
    return nullMatch[1];
  }
  return undefined;
}

/**
 * Columns we're willing to echo to an unauthenticated caller. Everything else
 * is redacted to avoid volunteering schema internals. Extend as needed — keep
 * it conservative.
 */
const SAFE_FIELD_WHITELIST = new Set<string>([
  'email',
  'username',
  'wallet_address',
  'onchain_escrow_id',
  'trade_id',
  'offer_id',
  'signature',
  'transaction_hash',
  'network_id',
]);

function filterSafeFields(fields: string[] | undefined): string[] | undefined {
  if (!fields) {
    return undefined;
  }
  const safe = fields.filter((f) => SAFE_FIELD_WHITELIST.has(f));
  return safe.length > 0 ? safe : undefined;
}

/**
 * Inspect a PostgreSQL error and return an HTTP-facing mapping. Returns
 * `null` if the error is not a recognised PG error; callers should fall back
 * to a generic 500 response.
 */
export function mapPgError(err: unknown): PgErrorMapping | null {
  if (!isPgError(err)) {
    return null;
  }

  const column = extractColumn(err);
  const rawFields = column ? [column] : undefined;
  const fields = filterSafeFields(rawFields);
  const safeColumn = fields?.[0];

  switch (err.code) {
    case '23505': // unique_violation
      return {
        status: 409,
        code: 'conflict',
        message: 'Resource already exists with that key',
        fields,
      };
    case '23503': // foreign_key_violation
      return {
        status: 409,
        code: 'referenced_resource_missing',
        message: 'A referenced resource does not exist',
        fields,
      };
    case '23502': // not_null_violation
      return {
        status: 400,
        code: 'missing_field',
        message: safeColumn ? `Missing required field: ${safeColumn}` : 'Missing required field',
        fields,
      };
    case '23514': // check_violation
      return {
        status: 400,
        code: 'invalid_value',
        message: 'A value failed a database check constraint',
        fields,
      };
    case 'YB001': // yapbay: finalized_row (migration 0038 triggers)
      return {
        status: 409,
        code: 'resource_finalized',
        message: 'This resource is in a terminal state and cannot be modified or deleted.',
      };
    case '22P02': // invalid_text_representation
      return {
        status: 400,
        code: 'invalid_value',
        message: 'A value has an invalid format for its column type',
      };
    case '40P01': // deadlock_detected
    case '40001': // serialization_failure
      return {
        status: 409,
        code: 'retry_conflict',
        message: 'Transient database conflict — retry the request',
        retryAfter: 1,
      };
    default:
      return null;
  }
}
