/**
 * Amount primitives.
 *
 * **Strings throughout, never numbers.** USDC amounts pass through the API as
 * decimal strings to preserve precision. JS arithmetic on financial values is
 * banned by `scripts/check-amount-coercion.ts` (CI). Conversions to BigInt
 * happen only at the database boundary via `decimalMath.toMicro()`.
 *
 * Mirrors `schema.sql`:
 *   - DECIMAL(15,6) for USDC crypto amounts (6 decimal places)
 *   - DECIMAL(15,2) for fiat amounts (2 decimal places)
 *   - escrows.amount has CHECK (amount <= 100.0) — see {@link escrowUsdcAmount}
 *   - disputes.bond_amount has CHECK (bond_amount > 0)
 */

import { z } from 'zod';

const USDC_DECIMAL_PLACES = 6;
const FIAT_DECIMAL_PLACES = 2;

/** Maximum scaled (micro) value for an escrow: 100.000000 USDC. */
const ESCROW_MAX_MICRO = 100n * 10n ** BigInt(USDC_DECIMAL_PLACES);

/**
 * Convert a decimal string with up to N fractional digits to scaled BigInt.
 * Returns null if the string can't be converted (guards against Zod 4
 * running all checks including refines even when the regex check fails).
 */
function toScaled(s: string, decimalPlaces: number): bigint | null {
  try {
    const [intPart, fracPart = ''] = s.split('.');
    const padded = fracPart.padEnd(decimalPlaces, '0').slice(0, decimalPlaces);
    return BigInt(intPart) * 10n ** BigInt(decimalPlaces) + BigInt(padded || '0');
  } catch {
    return null;
  }
}

/**
 * USDC crypto amount as a decimal string.
 *
 * - Up to 6 decimal places (matches DECIMAL(15,6))
 * - Must be strictly positive (> 0)
 * - No upper bound here; for the escrow-specific cap of 100, use {@link escrowUsdcAmount}
 *
 * Output type: `string` (NOT a number — never coerce to number).
 */
export const usdcAmount = z
  .string()
  .regex(
    /^(0|[1-9]\d*)(\.\d{1,6})?$/,
    'USDC amount must be a decimal string with up to 6 fractional digits (no leading zeros)',
  )
  .refine(
    (s) => {
      const v = toScaled(s, USDC_DECIMAL_PLACES);
      return v !== null && v > 0n;
    },
    { message: 'USDC amount must be greater than 0' },
  );

/**
 * USDC amount with the escrow contract cap of <= 100.000000 USDC.
 *
 * Mirrors `escrows.amount CHECK (amount <= 100.0)` in schema.sql.
 * Use this for any field destined for the `escrows` table.
 */
export const escrowUsdcAmount = z
  .string()
  .regex(
    /^(0|[1-9]\d*)(\.\d{1,6})?$/,
    'USDC amount must be a decimal string with up to 6 fractional digits (no leading zeros)',
  )
  .refine(
    (s) => {
      const v = toScaled(s, USDC_DECIMAL_PLACES);
      return v !== null && v > 0n;
    },
    { message: 'USDC amount must be greater than 0' },
  )
  .refine(
    (s) => {
      const v = toScaled(s, USDC_DECIMAL_PLACES);
      return v !== null && v <= ESCROW_MAX_MICRO;
    },
    { message: 'USDC amount must be <= 100.000000' },
  );

/**
 * Fiat amount as a decimal string.
 *
 * - Up to 2 decimal places (matches DECIMAL(15,2))
 * - Must be strictly positive (> 0)
 *
 * Output type: `string`.
 */
export const fiatAmount = z
  .string()
  .regex(
    /^(0|[1-9]\d*)(\.\d{1,2})?$/,
    'Fiat amount must be a decimal string with up to 2 fractional digits (no leading zeros)',
  )
  .refine(
    (s) => {
      const v = toScaled(s, FIAT_DECIMAL_PLACES);
      return v !== null && v > 0n;
    },
    { message: 'Fiat amount must be greater than 0' },
  );
