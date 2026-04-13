# 0003 — BigInt micro-unit decimal arithmetic

**Status**: Accepted (2026-04-12)

## Context

USDC and every stablecoin yapbay handles has 6 decimal places. JavaScript's
`Number` is IEEE-754 double: reliable integers up to 2^53 (~9 quadrillion),
but inexact on decimal fractions — `0.1 + 0.2 === 0.30000000000000004`.
A rounding error of one micro-unit per trade across hundreds of thousands
of trades compounds into an unreconcilable ledger.

## Decision

All money arithmetic goes through [src/utils/decimalMath.ts](../../src/utils/decimalMath.ts):
- `toMicro(value)` → `bigint` in integer micro-units (1 USDC = 1,000,000n).
- `fromMicro(bigint)` → decimal string with exactly 6 fractional digits.
- `subtract`, `compare`, `parse` wrap the same BigInt path.

Database columns use `NUMERIC(...)` with enough precision; the app layer
converts on read and write.

Violations are caught by:
- [scripts/check-amount-coercion.sh](../../scripts/check-amount-coercion.sh)
  (regex guard, runs pre-push + in CI).
- `.semgrep.yml` rule `yapbay-no-float-on-money` (SAST, runs in CI).
- Property tests in [src/tests/decimalMath.property.test.ts](../../src/tests/decimalMath.property.test.ts)
  (round-trip identity, associativity, transitive compare).

## Consequences

- Contributors cannot use `+ - * /` on any identifier matching
  `/amount|balance|fee|price|total|cost/`. Local arithmetic must be lifted
  to micro-units first.
- API boundaries serialize as decimal strings (`"12.345678"`), not numbers
  — clients that do their own math must follow the same pattern.
- BigInt serialization needs care: JSON.stringify on a `bigint` throws.
  Always `fromMicro(x)` to a string before emitting.

## Alternatives considered

- **decimal.js** — extra dependency, runtime branding that doesn't survive
  JSON boundaries. BigInt is native and free.
- **Integer-cents at 2 decimal places** — insufficient precision for USDC
  (6 decimals) and for fee math that divides small amounts.
- **Let the DB handle it (NUMERIC round-trip)** — doesn't help when the app
  does arithmetic before the write.
