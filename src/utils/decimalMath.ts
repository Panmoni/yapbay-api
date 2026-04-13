// Decimal arithmetic helpers for financial values.
//
// All amounts use 6 decimal places (USDC standard). Operations go through
// BigInt micro-units so we never touch IEEE-754 doubles — loss of precision
// at ~15 significant digits is a ledger-corrupting bug, not a rounding
// curiosity.
//
// This module has no side effects (no DB pool, no env reads) so it can be
// imported from tests and scripts without bringing up the full application.
// `src/db.ts` re-exports `decimalMath` for backwards compatibility with
// existing call sites that import from './db'.

const DECIMAL_PLACES = 6;
const SCALE = 10 ** DECIMAL_PLACES;
const SCALE_BIGINT = BigInt(SCALE);

// Strict decimal pattern: optional leading `-`, one or more digits, optional
// `.` followed by one or more fractional digits. Rejects scientific notation
// (`1e6`), hex (`0xff`), leading `+`, trailing whitespace, empty strings,
// Unicode minus — anything that isn't a well-formed signed base-10 decimal.
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export class DecimalMathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalMathError';
  }
}

function toCanonicalString(value: string | number): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new DecimalMathError(`toMicro: non-finite number ${value}`);
    }
    return value.toFixed(DECIMAL_PLACES);
  }
  const trimmed = value.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    throw new DecimalMathError(`toMicro: invalid decimal string ${JSON.stringify(value)}`);
  }
  return trimmed;
}

export const decimalMath = {
  /** Convert a decimal string/number to integer micro-units for safe arithmetic */
  toMicro(value: string | number): bigint {
    const str = toCanonicalString(value);
    const isNegative = str.startsWith('-');
    const unsigned = isNegative ? str.slice(1) : str;
    const [whole = '0', frac = ''] = unsigned.split('.');
    const paddedFrac = frac.padEnd(DECIMAL_PLACES, '0').slice(0, DECIMAL_PLACES);
    const magnitude = BigInt(whole) * SCALE_BIGINT + BigInt(paddedFrac);
    return isNegative ? -magnitude : magnitude;
  },

  /** Convert micro-units back to a decimal string */
  fromMicro(micro: bigint): string {
    const isNegative = micro < 0n;
    const abs = isNegative ? -micro : micro;
    const whole = abs / SCALE_BIGINT;
    const frac = (abs % SCALE_BIGINT).toString().padStart(DECIMAL_PLACES, '0');
    const sign = isNegative ? '-' : '';
    return `${sign}${whole}.${frac}`;
  },

  /** Subtract b from a, returning decimal string */
  subtract(a: string | number, b: string | number): string {
    return decimalMath.fromMicro(decimalMath.toMicro(a) - decimalMath.toMicro(b));
  },

  /** Compare: returns -1 if a < b, 0 if equal, 1 if a > b */
  compare(a: string | number, b: string | number): number {
    const diff = decimalMath.toMicro(a) - decimalMath.toMicro(b);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  },

  /**
   * Parse a value safely, returning null if not a valid decimal representation.
   * Rejects hex literals, scientific notation, octal, and `+`-prefixed strings
   * — `Number('0xff')` accidentally produces 255, so string inputs must pass
   * the same DECIMAL_RE gate as `toMicro`.
   */
  parse(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      if (!DECIMAL_RE.test(value.trim())) {
        return null;
      }
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return null;
      }
      return num.toFixed(DECIMAL_PLACES);
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }
      return value.toFixed(DECIMAL_PLACES);
    }
    if (typeof value === 'bigint') {
      // BigInt represents an integer, not decimal micro-units. Caller who
      // already has a bigint should use fromMicro directly; we treat this as
      // "whole units with zero fractional part" for safety.
      return `${value.toString()}.${'0'.repeat(DECIMAL_PLACES)}`;
    }
    return null;
  },
};

export const DECIMAL_CONSTANTS = { DECIMAL_PLACES, SCALE };
