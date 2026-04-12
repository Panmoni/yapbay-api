import { expect } from 'chai';
import {
  createTradeRequestSchema,
  createTradeResponseSchema,
  listMyTradesQuerySchema,
  listMyTradesResponseSchema,
  tradeIdParamsSchema,
  tradeRowSchema,
  tradeUpdateResponseSchema,
  updateTradeRequestSchema,
} from '../../schemas/trades';

// ---------------------------------------------------------------------------
// createTradeRequestSchema
// ---------------------------------------------------------------------------
describe('Trades: createTradeRequestSchema', () => {
  const valid = {
    leg1_offer_id: 1,
  };

  it('accepts minimal trade (only leg1_offer_id)', () => {
    expect(createTradeRequestSchema.safeParse(valid).success).to.be.true;
  });

  it('accepts full trade with all optional fields', () => {
    const full = {
      leg1_offer_id: 1,
      leg2_offer_id: 2,
      leg1_crypto_amount: '50.5',
      leg1_fiat_amount: '50.50',
      from_fiat_currency: 'USD',
      destination_fiat_currency: 'COP',
      from_bank: 'Chase',
      destination_bank: 'Bancolombia',
    };
    expect(createTradeRequestSchema.safeParse(full).success).to.be.true;
  });

  it('rejects missing leg1_offer_id', () => {
    expect(createTradeRequestSchema.safeParse({}).success).to.be.false;
  });

  it('rejects leg1_offer_id as string', () => {
    expect(createTradeRequestSchema.safeParse({ leg1_offer_id: '1' }).success).to.be.false;
  });

  it('rejects leg1_crypto_amount as number (must be string)', () => {
    expect(createTradeRequestSchema.safeParse({ ...valid, leg1_crypto_amount: 50.5 }).success).to.be
      .false;
  });

  it('rejects leg1_crypto_amount "0" (must be > 0)', () => {
    expect(createTradeRequestSchema.safeParse({ ...valid, leg1_crypto_amount: '0' }).success).to.be
      .false;
  });

  it('rejects invalid fiat currency "XX"', () => {
    expect(createTradeRequestSchema.safeParse({ ...valid, from_fiat_currency: 'XX' }).success).to.be
      .false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(createTradeRequestSchema.safeParse({ ...valid, network_id: 1 }).success).to.be.false;
  });

  it('rejects from_bank longer than 50 chars', () => {
    expect(createTradeRequestSchema.safeParse({ ...valid, from_bank: 'a'.repeat(51) }).success).to
      .be.false;
  });
});

// ---------------------------------------------------------------------------
// updateTradeRequestSchema
// ---------------------------------------------------------------------------
describe('Trades: updateTradeRequestSchema', () => {
  it('accepts empty object (all optional)', () => {
    expect(updateTradeRequestSchema.safeParse({}).success).to.be.true;
  });

  it('accepts leg1_state update', () => {
    expect(updateTradeRequestSchema.safeParse({ leg1_state: 'FUNDED' }).success).to.be.true;
  });

  it('accepts overall_status update', () => {
    expect(updateTradeRequestSchema.safeParse({ overall_status: 'COMPLETED' }).success).to.be.true;
  });

  it('accepts fiat_paid boolean', () => {
    expect(updateTradeRequestSchema.safeParse({ fiat_paid: true }).success).to.be.true;
  });

  it('rejects invalid leg1_state', () => {
    expect(updateTradeRequestSchema.safeParse({ leg1_state: 'PENDING' }).success).to.be.false;
  });

  it('rejects invalid overall_status', () => {
    expect(updateTradeRequestSchema.safeParse({ overall_status: 'ACTIVE' }).success).to.be.false;
  });

  it('rejects fiat_paid as string', () => {
    expect(updateTradeRequestSchema.safeParse({ fiat_paid: 'true' }).success).to.be.false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(updateTradeRequestSchema.safeParse({ cancelled: true }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// tradeIdParamsSchema
// ---------------------------------------------------------------------------
describe('Trades: tradeIdParamsSchema', () => {
  it('coerces "7" to { id: 7 }', () => {
    const result = tradeIdParamsSchema.safeParse({ id: '7' });
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.id).to.equal(7);
    }
  });

  it('rejects "abc"', () => {
    expect(tradeIdParamsSchema.safeParse({ id: 'abc' }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// listMyTradesQuerySchema
// ---------------------------------------------------------------------------
describe('Trades: listMyTradesQuerySchema', () => {
  it('applies defaults', () => {
    const result = listMyTradesQuerySchema.safeParse({});
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.limit).to.equal(25);
      expect(result.data.offset).to.equal(0);
    }
  });

  it('rejects unknown query params (strict)', () => {
    expect(listMyTradesQuerySchema.safeParse({ status: 'IN_PROGRESS' }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// tradeRowSchema (response)
// ---------------------------------------------------------------------------
describe('Trades: tradeRowSchema', () => {
  const validRow = {
    id: 1,
    leg1_offer_id: 10,
    leg2_offer_id: null,
    network_id: 3,
    overall_status: 'IN_PROGRESS',
    from_fiat_currency: 'USD',
    destination_fiat_currency: 'COP',
    from_bank: null,
    destination_bank: null,
    created_at: new Date(),
    updated_at: new Date(),
    leg1_state: 'CREATED',
    leg1_seller_account_id: 1,
    leg1_buyer_account_id: 2,
    leg1_crypto_token: 'USDC',
    leg1_crypto_amount: '50.000000',
    leg1_fiat_amount: null,
    leg1_fiat_currency: 'USD',
    leg1_created_at: new Date(),
    completed: false,
    cancelled: false,
  };

  it('accepts a minimal valid trade row', () => {
    expect(tradeRowSchema.safeParse(validRow).success).to.be.true;
  });

  it('accepts a row with all nullable leg1 fields populated', () => {
    const full = {
      ...validRow,
      leg1_escrow_address: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
      leg1_escrow_deposit_deadline: new Date(),
      leg1_fiat_payment_deadline: new Date(),
      leg1_fiat_paid_at: new Date(),
      leg1_released_at: null,
      leg1_cancelled_at: null,
      leg1_cancelled_by: null,
      leg1_dispute_id: null,
      leg1_escrow_onchain_id: null,
      completed_at: null,
      cancelled_at: null,
    };
    expect(tradeRowSchema.safeParse(full).success).to.be.true;
  });

  it('rejects missing required fields', () => {
    const { id: _, ...rest } = validRow;
    expect(tradeRowSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(tradeRowSchema.safeParse({ ...validRow, extra: true }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Wrapped response schemas
// ---------------------------------------------------------------------------
describe('Trades: createTradeResponseSchema', () => {
  const validRow = {
    id: 1,
    leg1_offer_id: 10,
    leg2_offer_id: null,
    network_id: 3,
    overall_status: 'IN_PROGRESS',
    from_fiat_currency: 'USD',
    destination_fiat_currency: 'COP',
    from_bank: null,
    destination_bank: null,
    created_at: new Date(),
    updated_at: new Date(),
    leg1_state: 'CREATED',
    leg1_seller_account_id: 1,
    leg1_buyer_account_id: 2,
    leg1_crypto_token: 'USDC',
    leg1_crypto_amount: '50.000000',
    leg1_fiat_amount: null,
    leg1_fiat_currency: 'USD',
    leg1_created_at: new Date(),
    completed: false,
    cancelled: false,
  };

  it('accepts { network, trade }', () => {
    expect(
      createTradeResponseSchema.safeParse({ network: 'solana-devnet', trade: validRow }).success,
    ).to.be.true;
  });
});

describe('Trades: listMyTradesResponseSchema', () => {
  it('accepts { network, trades: [] }', () => {
    expect(listMyTradesResponseSchema.safeParse({ network: 'solana-devnet', trades: [] }).success)
      .to.be.true;
  });
});

describe('Trades: tradeUpdateResponseSchema', () => {
  it('accepts { id: 1 }', () => {
    expect(tradeUpdateResponseSchema.safeParse({ id: 1 }).success).to.be.true;
  });

  it('rejects { id: 0 }', () => {
    expect(tradeUpdateResponseSchema.safeParse({ id: 0 }).success).to.be.false;
  });

  it('rejects extra fields (strict)', () => {
    expect(tradeUpdateResponseSchema.safeParse({ id: 1, status: 'ok' }).success).to.be.false;
  });
});
