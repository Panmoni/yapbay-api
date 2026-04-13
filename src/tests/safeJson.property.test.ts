// Property tests for safeJsonParse (src/utils/safeJson.ts).
//
// Run via `pnpm test:property` — no DB required, no mocharc setup, fast.
// Intent: verify the three load-bearing guarantees the middleware + route
// handlers depend on:
//   1. Never throws regardless of input shape (middleware mustn't 500 on
//      malformed metadata from the listener or the DB).
//   2. Returns the parsed value on valid input; returns null on invalid.
//   3. Optional Zod schema gate; mismatch returns null, not a partial parse.

import { expect } from 'chai';
import fc from 'fast-check';
import { z } from 'zod';
import { safeJsonParse } from '../utils/safeJson';

// Printable ASCII strings cover the realistic wire shape without drowning
// the runner in Unicode weirdness.
const stringArb = fc.string({ minLength: 0, maxLength: 200 });

describe('safeJsonParse (property-based)', () => {
  it('never throws on arbitrary string input', () => {
    fc.assert(
      fc.property(stringArb, (s) => {
        // Any completion without throwing is a pass.
        safeJsonParse(s);
      }),
      { numRuns: 1000 },
    );
  });

  it('never throws on arbitrary non-string input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.float(),
          fc.boolean(),
          fc.object(),
          fc.array(fc.integer()),
        ),
        (input) => {
          safeJsonParse(input);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('round-trips valid JSON.stringify output for plain objects', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer()), (obj) => {
        const s = JSON.stringify(obj);
        const parsed = safeJsonParse<Record<string, number>>(s);
        expect(parsed).to.deep.equal(obj);
      }),
      { numRuns: 500 },
    );
  });

  it('returns null on malformed JSON strings', () => {
    const bad = ['{', 'not json', '"unterminated', '{"a":}', 'undefined', ''];
    for (const input of bad) {
      expect(safeJsonParse(input)).to.equal(null);
    }
  });

  it('returns already-parsed object input as-is', () => {
    const obj = { a: 1, b: 'two' };
    expect(safeJsonParse(obj)).to.equal(obj);
  });

  it('treats null and undefined as null (not parsed)', () => {
    expect(safeJsonParse(null)).to.equal(null);
    expect(safeJsonParse(undefined)).to.equal(null);
  });

  it('onError fires on parse failure but not on success', () => {
    let count = 0;
    const onError = () => {
      count++;
    };

    expect(safeJsonParse('{valid:false', { onError })).to.equal(null);
    expect(count).to.equal(1);

    expect(safeJsonParse('{"ok":true}', { onError })).to.deep.equal({ ok: true });
    expect(count).to.equal(1);
  });

  describe('with Zod schema', () => {
    const schema = z.object({ id: z.number(), name: z.string() });

    it('returns parsed value when schema matches', () => {
      const input = JSON.stringify({ id: 1, name: 'a' });
      expect(safeJsonParse(input, { schema })).to.deep.equal({ id: 1, name: 'a' });
    });

    it('returns null on schema mismatch (no partial data)', () => {
      const input = JSON.stringify({ id: 'not-a-number', name: 'a' });
      expect(safeJsonParse(input, { schema })).to.equal(null);
    });

    it('onError fires on schema mismatch with an Error', () => {
      let captured: Error | null = null;
      safeJsonParse(JSON.stringify({ id: 'nope' }), {
        schema,
        onError: (err) => {
          captured = err;
        },
      });
      expect(captured).to.be.instanceOf(Error);
    });

    it('schema mismatch never leaks partial object shape', () => {
      const input = JSON.stringify({ id: 1 }); // missing `name`
      const result = safeJsonParse(input, { schema });
      expect(result).to.equal(null);
    });
  });
});
