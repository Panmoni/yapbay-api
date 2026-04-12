import { expect } from 'chai';
import {
  adminEscrowParamsSchema,
  adminLoginRequestSchema,
  adminLoginResponseSchema,
  adminTradesQuerySchema,
  adminTradesResponseSchema,
  deadlineStatsAllResponseSchema,
  deadlineStatsNetworkIdParamsSchema,
  deadlineStatsQuerySchema,
} from '../../schemas/admin';

// ---------------------------------------------------------------------------
// Admin trades
// ---------------------------------------------------------------------------
describe('Admin: adminTradesQuerySchema', () => {
  it('applies defaults (page=1, limit=10)', () => {
    const result = adminTradesQuerySchema.safeParse({});
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.page).to.equal(1);
      expect(result.data.limit).to.equal(10);
    }
  });

  it('coerces string values', () => {
    const result = adminTradesQuerySchema.safeParse({ page: '3', limit: '20' });
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.page).to.equal(3);
      expect(result.data.limit).to.equal(20);
    }
  });

  it('rejects page=0', () => {
    expect(adminTradesQuerySchema.safeParse({ page: '0' }).success).to.be.false;
  });

  it('rejects limit=101', () => {
    expect(adminTradesQuerySchema.safeParse({ limit: '101' }).success).to.be.false;
  });

  it('rejects unknown query params (strict)', () => {
    expect(adminTradesQuerySchema.safeParse({ status: 'active' }).success).to.be.false;
  });
});

describe('Admin: adminTradesResponseSchema', () => {
  it('accepts valid response with empty data', () => {
    expect(
      adminTradesResponseSchema.safeParse({
        data: [],
        meta: { page: 1, limit: 10, total: 0 },
      }).success,
    ).to.be.true;
  });

  it('rejects missing meta', () => {
    expect(adminTradesResponseSchema.safeParse({ data: [] }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Admin escrows
// ---------------------------------------------------------------------------
describe('Admin: adminEscrowParamsSchema', () => {
  it('coerces "5" to { trade_id: 5 }', () => {
    const result = adminEscrowParamsSchema.safeParse({ trade_id: '5' });
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.trade_id).to.equal(5);
    }
  });

  it('rejects "abc"', () => {
    expect(adminEscrowParamsSchema.safeParse({ trade_id: 'abc' }).success).to.be.false;
  });

  it('rejects extra params (strict)', () => {
    expect(adminEscrowParamsSchema.safeParse({ trade_id: '1', extra: 'yes' }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Admin deadline stats
// ---------------------------------------------------------------------------
describe('Admin: deadlineStatsQuerySchema', () => {
  it('accepts empty object', () => {
    expect(deadlineStatsQuerySchema.safeParse({}).success).to.be.true;
  });

  it('rejects unknown params (strict)', () => {
    expect(deadlineStatsQuerySchema.safeParse({ foo: 'bar' }).success).to.be.false;
  });
});

describe('Admin: deadlineStatsNetworkIdParamsSchema', () => {
  it('coerces "3" to { networkId: 3 }', () => {
    const result = deadlineStatsNetworkIdParamsSchema.safeParse({ networkId: '3' });
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.networkId).to.equal(3);
    }
  });

  it('rejects "0"', () => {
    expect(deadlineStatsNetworkIdParamsSchema.safeParse({ networkId: '0' }).success).to.be.false;
  });
});

describe('Admin: deadlineStatsAllResponseSchema', () => {
  it('accepts valid response', () => {
    expect(
      deadlineStatsAllResponseSchema.safeParse({
        success: true,
        data: { some: 'stats' },
        timestamp: '2025-01-01T00:00:00.000Z',
      }).success,
    ).to.be.true;
  });

  it('rejects success: false', () => {
    expect(
      deadlineStatsAllResponseSchema.safeParse({
        success: false,
        data: null,
        timestamp: '2025-01-01T00:00:00.000Z',
      }).success,
    ).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Auth — admin login
// ---------------------------------------------------------------------------
describe('Admin: adminLoginRequestSchema', () => {
  it('accepts valid credentials', () => {
    expect(adminLoginRequestSchema.safeParse({ username: 'admin', password: 'secret123' }).success)
      .to.be.true;
  });

  it('rejects empty username', () => {
    expect(adminLoginRequestSchema.safeParse({ username: '', password: 'secret123' }).success).to.be
      .false;
  });

  it('rejects empty password', () => {
    expect(adminLoginRequestSchema.safeParse({ username: 'admin', password: '' }).success).to.be
      .false;
  });

  it('rejects missing username', () => {
    expect(adminLoginRequestSchema.safeParse({ password: 'secret123' }).success).to.be.false;
  });

  it('rejects missing password', () => {
    expect(adminLoginRequestSchema.safeParse({ username: 'admin' }).success).to.be.false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(
      adminLoginRequestSchema.safeParse({ username: 'admin', password: 'x', role: 'admin' })
        .success,
    ).to.be.false;
  });
});

describe('Admin: adminLoginResponseSchema', () => {
  it('accepts valid token response', () => {
    expect(adminLoginResponseSchema.safeParse({ token: 'eyJhbGci...' }).success).to.be.true;
  });

  it('rejects empty token', () => {
    expect(adminLoginResponseSchema.safeParse({ token: '' }).success).to.be.false;
  });

  it('rejects extra fields (strict)', () => {
    expect(adminLoginResponseSchema.safeParse({ token: 'abc', user: 'admin' }).success).to.be.false;
  });
});
