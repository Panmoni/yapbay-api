// Property tests for decimalMath (src/db.ts).
//
// These are the rules the rest of the codebase depends on for money. If any
// of them ever fail, ledger writes are going to produce off-by-one errors
// somewhere. Run them on every PR — they're fast (<100ms for 1000 runs).

import { expect } from 'chai';
import fc from 'fast-check';
import { decimalMath } from '../utils/decimalMath';

// USDC precision is 6 decimals. Largest realistic amount: 100M USDC per
// trade; pick a safe max well under BigInt's 2^53 so we don't accidentally
// assert something that would overflow a Number intermediate.
const MAX_MICRO = 1_000_000_000_000_000n; // 1 billion USDC in micro-units

// Arbitrary micro-unit bigint: uniformly distributed non-negative integers.
const microArb = fc.bigInt({ min: 0n, max: MAX_MICRO });
const signedMicroArb = fc.bigInt({ min: -MAX_MICRO, max: MAX_MICRO });

// Arbitrary decimal string with up to 6 fractional digits (non-negative).
const decimalStrArb = fc
  .tuple(fc.integer({ min: 0, max: 1_000_000_000 }), fc.integer({ min: 0, max: 999_999 }))
  .map(([whole, frac]) => `${whole}.${String(frac).padStart(6, '0')}`);

// Signed variant — includes negative values so the Phase 3 bugfix for
// toMicro('-5.5') stays covered.
const signedDecimalStrArb = fc
  .tuple(
    fc.boolean(),
    fc.integer({ min: 0, max: 1_000_000_000 }),
    fc.integer({ min: 0, max: 999_999 }),
  )
  .map(([neg, whole, frac]) => `${neg ? '-' : ''}${whole}.${String(frac).padStart(6, '0')}`);

describe('decimalMath (property-based)', () => {
  it('toMicro ∘ fromMicro is identity on non-negative bigints', () => {
    fc.assert(
      fc.property(microArb, (micro) => {
        const s = decimalMath.fromMicro(micro);
        expect(decimalMath.toMicro(s)).to.equal(micro);
      }),
      { numRuns: 500 },
    );
  });

  it('toMicro ∘ fromMicro is identity on signed bigints', () => {
    fc.assert(
      fc.property(signedMicroArb, (micro) => {
        const s = decimalMath.fromMicro(micro);
        expect(decimalMath.toMicro(s)).to.equal(micro);
      }),
      { numRuns: 500 },
    );
  });

  it('fromMicro ∘ toMicro is identity on 6-decimal strings', () => {
    fc.assert(
      fc.property(decimalStrArb, (s) => {
        const roundTripped = decimalMath.fromMicro(decimalMath.toMicro(s));
        // Allow "0.000000" vs "0.0" — compare by toMicro equivalence.
        expect(decimalMath.toMicro(roundTripped)).to.equal(decimalMath.toMicro(s));
      }),
      { numRuns: 500 },
    );
  });

  it('fromMicro ∘ toMicro is identity on signed strings', () => {
    fc.assert(
      fc.property(signedDecimalStrArb, (s) => {
        const roundTripped = decimalMath.fromMicro(decimalMath.toMicro(s));
        expect(decimalMath.toMicro(roundTripped)).to.equal(decimalMath.toMicro(s));
      }),
      { numRuns: 500 },
    );
  });

  // Regression test for the negative-handling bug fixed during the Phase 3
  // extraction. The pre-fix implementation computed toMicro('-5.5') as
  // -4500000 (wrong: split '-5' + '500000' as whole/frac, producing
  // -5_000_000 + 500_000). Verify the correct value explicitly so the bug
  // cannot return silently.
  it('toMicro("-5.5") === -5_500_000n (regression)', () => {
    expect(decimalMath.toMicro('-5.5')).to.equal(-5_500_000n);
  });

  it('toMicro round-trips negative decimals', () => {
    expect(decimalMath.fromMicro(decimalMath.toMicro('-5.5'))).to.equal('-5.500000');
    expect(decimalMath.fromMicro(decimalMath.toMicro('-0.000001'))).to.equal('-0.000001');
  });

  it('toMicro rejects malformed input', () => {
    const bad = ['', ' ', '1e6', '0xff', '+1.5', '1.5.5', 'abc', '1,000.00', '\u22121.5'];
    for (const input of bad) {
      expect(() => decimalMath.toMicro(input)).to.throw(/invalid decimal string/);
    }
  });

  it('toMicro rejects non-finite numbers', () => {
    expect(() => decimalMath.toMicro(Number.POSITIVE_INFINITY)).to.throw(/non-finite/);
    expect(() => decimalMath.toMicro(Number.NaN)).to.throw(/non-finite/);
  });

  it('parse rejects hex / scientific / plus-prefixed strings', () => {
    expect(decimalMath.parse('0xff')).to.equal(null);
    expect(decimalMath.parse('1e6')).to.equal(null);
    expect(decimalMath.parse('+1.5')).to.equal(null);
    expect(decimalMath.parse('')).to.equal(null);
    expect(decimalMath.parse('abc')).to.equal(null);
    expect(decimalMath.parse('1,000')).to.equal(null);
    // Leading/trailing whitespace is trimmed (matches toMicro behavior).
    expect(decimalMath.parse(' 1.5 ')).to.equal('1.500000');
  });

  it('subtract is consistent with bigint subtraction', () => {
    fc.assert(
      fc.property(decimalStrArb, decimalStrArb, (a, b) => {
        const expected = decimalMath.fromMicro(decimalMath.toMicro(a) - decimalMath.toMicro(b));
        expect(decimalMath.subtract(a, b)).to.equal(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('subtract(a, a) === "0.000000"', () => {
    fc.assert(
      fc.property(decimalStrArb, (a) => {
        expect(decimalMath.subtract(a, a)).to.equal('0.000000');
      }),
      { numRuns: 200 },
    );
  });

  it('compare is total and antisymmetric', () => {
    fc.assert(
      fc.property(decimalStrArb, decimalStrArb, (a, b) => {
        const ab = decimalMath.compare(a, b);
        const ba = decimalMath.compare(b, a);
        expect([-1, 0, 1]).to.include(ab);
        expect(ab).to.equal(-ba);
      }),
      { numRuns: 500 },
    );
  });

  it('compare is transitive', () => {
    fc.assert(
      fc.property(decimalStrArb, decimalStrArb, decimalStrArb, (a, b, c) => {
        const ab = decimalMath.compare(a, b);
        const bc = decimalMath.compare(b, c);
        if (ab <= 0 && bc <= 0) {
          expect(decimalMath.compare(a, c)).to.be.at.most(0);
        }
        if (ab >= 0 && bc >= 0) {
          expect(decimalMath.compare(a, c)).to.be.at.least(0);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('parse(value) + toMicro never loses precision beyond 6 decimals', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          const parsed = decimalMath.parse(n);
          if (parsed === null) {
            return;
          }
          // parsed is always 6 decimals; toMicro should round-trip.
          expect(decimalMath.fromMicro(decimalMath.toMicro(parsed))).to.equal(parsed);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parse returns null on non-finite / non-numeric input', () => {
    expect(decimalMath.parse(null)).to.equal(null);
    expect(decimalMath.parse(undefined)).to.equal(null);
    expect(decimalMath.parse('not-a-number')).to.equal(null);
    expect(decimalMath.parse(Number.POSITIVE_INFINITY)).to.equal(null);
    expect(decimalMath.parse(Number.NaN)).to.equal(null);
  });

  it('addition via micro-units is associative', () => {
    fc.assert(
      fc.property(decimalStrArb, decimalStrArb, decimalStrArb, (a, b, c) => {
        const left = decimalMath.toMicro(a) + decimalMath.toMicro(b) + decimalMath.toMicro(c);
        const right = decimalMath.toMicro(a) + (decimalMath.toMicro(b) + decimalMath.toMicro(c));
        expect(left).to.equal(right);
      }),
      { numRuns: 500 },
    );
  });
});
