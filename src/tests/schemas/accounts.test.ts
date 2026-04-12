import { expect } from 'chai';
import {
  accountFullResponseSchema,
  accountGetByIdResponseSchema,
  accountIdParamsSchema,
  accountMutationResponseSchema,
  accountPublicResponseSchema,
  createAccountRequestSchema,
  updateAccountRequestSchema,
} from '../../schemas/accounts';

// ---------------------------------------------------------------------------
// createAccountRequestSchema
// ---------------------------------------------------------------------------
describe('Accounts: createAccountRequestSchema', () => {
  const validEvm = {
    wallet_address: '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383',
    username: 'alice',
    email: 'alice@example.com',
  };

  const validSolana = {
    wallet_address: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
    username: 'bob',
    email: 'bob@example.com',
  };

  it('accepts a valid EVM-based account', () => {
    expect(createAccountRequestSchema.safeParse(validEvm).success).to.be.true;
  });

  it('accepts a valid Solana-based account', () => {
    expect(createAccountRequestSchema.safeParse(validSolana).success).to.be.true;
  });

  it('rejects missing wallet_address', () => {
    const { wallet_address: _, ...rest } = validEvm;
    expect(createAccountRequestSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects missing username', () => {
    const { username: _, ...rest } = validEvm;
    expect(createAccountRequestSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects missing email', () => {
    const { email: _, ...rest } = validEvm;
    expect(createAccountRequestSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects invalid email', () => {
    expect(createAccountRequestSchema.safeParse({ ...validEvm, email: 'not-an-email' }).success).to
      .be.false;
  });

  it('rejects an invalid wallet address', () => {
    expect(createAccountRequestSchema.safeParse({ ...validEvm, wallet_address: 'invalid' }).success)
      .to.be.false;
  });

  it('rejects username longer than 50 chars', () => {
    expect(createAccountRequestSchema.safeParse({ ...validEvm, username: 'a'.repeat(51) }).success)
      .to.be.false;
  });

  it('rejects empty username', () => {
    expect(createAccountRequestSchema.safeParse({ ...validEvm, username: '' }).success).to.be.false;
  });

  it('rejects email longer than 100 chars', () => {
    const longEmail = `${'a'.repeat(90)}@example.com`;
    expect(createAccountRequestSchema.safeParse({ ...validEvm, email: longEmail }).success).to.be
      .false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(createAccountRequestSchema.safeParse({ ...validEvm, role: 'admin' }).success).to.be
      .false;
  });
});

// ---------------------------------------------------------------------------
// updateAccountRequestSchema
// ---------------------------------------------------------------------------
describe('Accounts: updateAccountRequestSchema', () => {
  it('accepts an empty object (all optional)', () => {
    expect(updateAccountRequestSchema.safeParse({}).success).to.be.true;
  });

  it('accepts a partial update with just username', () => {
    expect(updateAccountRequestSchema.safeParse({ username: 'newname' }).success).to.be.true;
  });

  it('accepts a full update with all fields', () => {
    const full = {
      username: 'newname',
      email: 'new@example.com',
      telegram_username: '@newuser',
      telegram_id: 12_345,
      profile_photo_url: 'https://example.com/photo.jpg',
      phone_country_code: '+1',
      phone_number: '5551234567',
      available_from: '09:00',
      available_to: '17:00',
      timezone: 'America/New_York',
    };
    expect(updateAccountRequestSchema.safeParse(full).success).to.be.true;
  });

  it('rejects invalid email', () => {
    expect(updateAccountRequestSchema.safeParse({ email: 'bad' }).success).to.be.false;
  });

  it('rejects username longer than 50 chars', () => {
    expect(updateAccountRequestSchema.safeParse({ username: 'a'.repeat(51) }).success).to.be.false;
  });

  it('rejects invalid profile_photo_url', () => {
    expect(updateAccountRequestSchema.safeParse({ profile_photo_url: 'not-a-url' }).success).to.be
      .false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(updateAccountRequestSchema.safeParse({ wallet_address: '0x123' }).success).to.be.false;
  });

  it('rejects telegram_id as string', () => {
    expect(updateAccountRequestSchema.safeParse({ telegram_id: '12345' }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// accountIdParamsSchema
// ---------------------------------------------------------------------------
describe('Accounts: accountIdParamsSchema', () => {
  it('coerces "1" to { id: 1 }', () => {
    const result = accountIdParamsSchema.safeParse({ id: '1' });
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.id).to.equal(1);
    }
  });

  it('rejects "0"', () => {
    expect(accountIdParamsSchema.safeParse({ id: '0' }).success).to.be.false;
  });

  it('rejects "abc"', () => {
    expect(accountIdParamsSchema.safeParse({ id: 'abc' }).success).to.be.false;
  });

  it('rejects unknown params (strict)', () => {
    expect(accountIdParamsSchema.safeParse({ id: '1', extra: 'yes' }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------
describe('Accounts: accountFullResponseSchema', () => {
  const validFull = {
    id: 1,
    wallet_address: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
    username: 'alice',
    email: 'alice@example.com',
    telegram_username: null,
    telegram_id: null,
    profile_photo_url: null,
    phone_country_code: null,
    phone_number: null,
    available_from: null,
    available_to: null,
    timezone: null,
    role: 'user',
    created_at: new Date(),
    updated_at: new Date(),
  };

  it('accepts a valid full account response', () => {
    expect(accountFullResponseSchema.safeParse(validFull).success).to.be.true;
  });

  it('accepts string dates (ISO)', () => {
    const withStrings = {
      ...validFull,
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
    };
    expect(accountFullResponseSchema.safeParse(withStrings).success).to.be.true;
  });

  it('accepts TIME strings for available_from/to', () => {
    const withTime = {
      ...validFull,
      available_from: '09:00:00',
      available_to: '17:00:00',
    };
    expect(accountFullResponseSchema.safeParse(withTime).success).to.be.true;
  });

  it('accepts telegram_id as BIGINT string', () => {
    const withBigint = { ...validFull, telegram_id: '123456789012345' };
    expect(accountFullResponseSchema.safeParse(withBigint).success).to.be.true;
  });

  it('accepts telegram_id as number', () => {
    const withNum = { ...validFull, telegram_id: 123_456 };
    expect(accountFullResponseSchema.safeParse(withNum).success).to.be.true;
  });

  it('rejects missing required fields', () => {
    const { email: _, ...rest } = validFull;
    expect(accountFullResponseSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(accountFullResponseSchema.safeParse({ ...validFull, extra: 'yes' }).success).to.be.false;
  });

  it('rejects invalid role', () => {
    expect(accountFullResponseSchema.safeParse({ ...validFull, role: 'superadmin' }).success).to.be
      .false;
  });
});

describe('Accounts: accountPublicResponseSchema', () => {
  const validPublic = {
    id: 1,
    wallet_address: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
    username: 'alice',
    telegram_username: null,
    telegram_id: null,
    profile_photo_url: null,
    available_from: null,
    available_to: null,
    timezone: null,
    created_at: new Date(),
  };

  it('accepts a valid public profile', () => {
    expect(accountPublicResponseSchema.safeParse(validPublic).success).to.be.true;
  });

  it('rejects extra private fields (strict)', () => {
    expect(
      accountPublicResponseSchema.safeParse({ ...validPublic, email: 'alice@example.com' }).success,
    ).to.be.false;
  });
});

describe('Accounts: accountGetByIdResponseSchema (union)', () => {
  const fullProfile = {
    id: 1,
    wallet_address: '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383',
    username: 'alice',
    email: 'alice@example.com',
    telegram_username: null,
    telegram_id: null,
    profile_photo_url: null,
    phone_country_code: null,
    phone_number: null,
    available_from: null,
    available_to: null,
    timezone: null,
    role: 'user',
    created_at: new Date(),
    updated_at: new Date(),
  };

  const publicProfile = {
    id: 1,
    wallet_address: '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383',
    username: 'alice',
    telegram_username: null,
    telegram_id: null,
    profile_photo_url: null,
    available_from: null,
    available_to: null,
    timezone: null,
    created_at: new Date(),
  };

  it('accepts a full profile', () => {
    expect(accountGetByIdResponseSchema.safeParse(fullProfile).success).to.be.true;
  });

  it('accepts a public profile', () => {
    expect(accountGetByIdResponseSchema.safeParse(publicProfile).success).to.be.true;
  });

  it('rejects an invalid shape', () => {
    expect(accountGetByIdResponseSchema.safeParse({ id: 'abc' }).success).to.be.false;
  });
});

describe('Accounts: accountMutationResponseSchema', () => {
  it('accepts { id: 1 }', () => {
    expect(accountMutationResponseSchema.safeParse({ id: 1 }).success).to.be.true;
  });

  it('rejects { id: 0 }', () => {
    expect(accountMutationResponseSchema.safeParse({ id: 0 }).success).to.be.false;
  });

  it('rejects extra fields', () => {
    expect(accountMutationResponseSchema.safeParse({ id: 1, name: 'x' }).success).to.be.false;
  });
});
