import { expect } from 'chai';
import { mapPgError } from '../utils/pgError';

describe('mapPgError', () => {
  it('maps 23505 unique_violation → 409 conflict with field extracted from detail', () => {
    const mapped = mapPgError({
      code: '23505',
      detail: 'Key (email)=(a@b.com) already exists.',
    });
    expect(mapped).to.deep.equal({
      status: 409,
      code: 'conflict',
      message: 'Resource already exists with that key',
      fields: ['email'],
    });
  });

  it('maps 23503 foreign_key_violation → 409 referenced_resource_missing (whitelisted column echoed)', () => {
    const mapped = mapPgError({
      code: '23503',
      detail: 'Key (wallet_address)=(0xabc) is not present in table "accounts".',
    });
    expect(mapped?.status).to.equal(409);
    expect(mapped?.code).to.equal('referenced_resource_missing');
    expect(mapped?.fields).to.deep.equal(['wallet_address']);
  });

  it('strips non-whitelisted columns from fields (e.g. user_id)', () => {
    const mapped = mapPgError({
      code: '23503',
      detail: 'Key (user_id)=(42) is not present in table "users".',
    });
    expect(mapped?.fields).to.equal(undefined);
  });

  it('maps 23502 not_null_violation with non-whitelisted column → generic message, no fields', () => {
    const mapped = mapPgError({
      code: '23502',
      column: 'amount',
      detail: 'null value in column "amount" of relation "trades" violates not-null constraint',
    });
    expect(mapped?.status).to.equal(400);
    expect(mapped?.code).to.equal('missing_field');
    expect(mapped?.fields).to.equal(undefined);
    expect(mapped?.message).to.equal('Missing required field');
  });

  it('maps 23502 not_null_violation with whitelisted column → message includes column', () => {
    const mapped = mapPgError({
      code: '23502',
      column: 'email',
      detail: 'null value in column "email" of relation "accounts" violates not-null constraint',
    });
    expect(mapped?.fields).to.deep.equal(['email']);
    expect(mapped?.message).to.contain('email');
  });

  it('maps 23514 check_violation → 400 invalid_value', () => {
    const mapped = mapPgError({ code: '23514', constraint: 'amount_positive' });
    expect(mapped?.status).to.equal(400);
    expect(mapped?.code).to.equal('invalid_value');
  });

  it('maps 22P02 invalid_text_representation → 400 invalid_value', () => {
    const mapped = mapPgError({ code: '22P02' });
    expect(mapped?.status).to.equal(400);
    expect(mapped?.code).to.equal('invalid_value');
  });

  it('maps 40P01 deadlock → 409 retry_conflict with retryAfter', () => {
    const mapped = mapPgError({ code: '40P01' });
    expect(mapped?.status).to.equal(409);
    expect(mapped?.code).to.equal('retry_conflict');
    expect(mapped?.retryAfter).to.equal(1);
  });

  it('maps 40001 serialization_failure → 409 retry_conflict', () => {
    const mapped = mapPgError({ code: '40001' });
    expect(mapped?.code).to.equal('retry_conflict');
  });

  it('returns null for non-PG errors', () => {
    expect(mapPgError(new Error('boom'))).to.equal(null);
    expect(mapPgError({ code: 'ECONNRESET' })).to.equal(null);
    expect(mapPgError(null)).to.equal(null);
    expect(mapPgError(undefined)).to.equal(null);
  });

  it('returns null for unrecognized PG codes', () => {
    expect(mapPgError({ code: '99999' })).to.equal(null);
  });
});
