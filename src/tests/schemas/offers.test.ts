import { expect } from 'chai';
import {
  createOfferRequestSchema,
  createOfferResponseSchema,
  deleteOfferResponseSchema,
  listOffersQuerySchema,
  listOffersResponseSchema,
  offerIdParamsSchema,
  offerRowSchema,
  updateOfferRequestSchema,
} from '../../schemas/offers';

// ---------------------------------------------------------------------------
// createOfferRequestSchema
// ---------------------------------------------------------------------------
describe('Offers: createOfferRequestSchema', () => {
  const valid = {
    creator_account_id: 1,
    offer_type: 'BUY' as const,
    min_amount: '10.5',
  };

  it('accepts a minimal valid offer', () => {
    expect(createOfferRequestSchema.safeParse(valid).success).to.be.true;
  });

  it('accepts a full offer with all optional fields', () => {
    const full = {
      ...valid,
      fiat_currency: 'COP',
      max_amount: '50',
      total_available_amount: '200',
      rate_adjustment: 1.05,
      terms: 'Bank transfer only',
      token: 'USDC' as const,
      escrow_deposit_time_limit: '20 minutes',
      fiat_payment_time_limit: '45 minutes',
    };
    expect(createOfferRequestSchema.safeParse(full).success).to.be.true;
  });

  it('defaults fiat_currency to USD', () => {
    const result = createOfferRequestSchema.safeParse(valid);
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.fiat_currency).to.equal('USD');
    }
  });

  it('rejects missing creator_account_id', () => {
    const { creator_account_id: _, ...rest } = valid;
    expect(createOfferRequestSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects missing offer_type', () => {
    const { offer_type: _, ...rest } = valid;
    expect(createOfferRequestSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects missing min_amount', () => {
    const { min_amount: _, ...rest } = valid;
    expect(createOfferRequestSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects invalid offer_type "SWAP"', () => {
    expect(createOfferRequestSchema.safeParse({ ...valid, offer_type: 'SWAP' }).success).to.be
      .false;
  });

  it('rejects min_amount as a number (must be string)', () => {
    expect(createOfferRequestSchema.safeParse({ ...valid, min_amount: 10.5 }).success).to.be.false;
  });

  it('rejects min_amount "0" (must be > 0)', () => {
    expect(createOfferRequestSchema.safeParse({ ...valid, min_amount: '0' }).success).to.be.false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(createOfferRequestSchema.safeParse({ ...valid, network_id: 1 }).success).to.be.false;
  });

  it('rejects negative rate_adjustment', () => {
    expect(createOfferRequestSchema.safeParse({ ...valid, rate_adjustment: -0.5 }).success).to.be
      .false;
  });

  it('rejects invalid fiat_currency "USDX"', () => {
    expect(createOfferRequestSchema.safeParse({ ...valid, fiat_currency: 'USDX' }).success).to.be
      .false;
  });
});

// ---------------------------------------------------------------------------
// updateOfferRequestSchema
// ---------------------------------------------------------------------------
describe('Offers: updateOfferRequestSchema', () => {
  it('accepts empty object (all optional)', () => {
    expect(updateOfferRequestSchema.safeParse({}).success).to.be.true;
  });

  it('accepts partial update', () => {
    expect(updateOfferRequestSchema.safeParse({ min_amount: '5' }).success).to.be.true;
  });

  it('accepts time limit as string', () => {
    expect(updateOfferRequestSchema.safeParse({ escrow_deposit_time_limit: '20 minutes' }).success)
      .to.be.true;
  });

  it('accepts time limit as object with minutes', () => {
    expect(
      updateOfferRequestSchema.safeParse({ escrow_deposit_time_limit: { minutes: 20 } }).success,
    ).to.be.true;
  });

  it('rejects unknown fields (strict)', () => {
    expect(updateOfferRequestSchema.safeParse({ creator_account_id: 1 }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// offerIdParamsSchema
// ---------------------------------------------------------------------------
describe('Offers: offerIdParamsSchema', () => {
  it('coerces "42" to { id: 42 }', () => {
    const result = offerIdParamsSchema.safeParse({ id: '42' });
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.id).to.equal(42);
    }
  });

  it('rejects "0"', () => {
    expect(offerIdParamsSchema.safeParse({ id: '0' }).success).to.be.false;
  });

  it('rejects extra params (strict)', () => {
    expect(offerIdParamsSchema.safeParse({ id: '1', foo: 'bar' }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// listOffersQuerySchema
// ---------------------------------------------------------------------------
describe('Offers: listOffersQuerySchema', () => {
  it('accepts empty query (defaults applied)', () => {
    const result = listOffersQuerySchema.safeParse({});
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.limit).to.equal(25);
      expect(result.data.offset).to.equal(0);
    }
  });

  it('accepts type filter', () => {
    expect(listOffersQuerySchema.safeParse({ type: 'BUY' }).success).to.be.true;
  });

  it('accepts owner=me', () => {
    expect(listOffersQuerySchema.safeParse({ owner: 'me' }).success).to.be.true;
  });

  it('accepts token filter', () => {
    expect(listOffersQuerySchema.safeParse({ token: 'USDC' }).success).to.be.true;
  });

  it('rejects unknown query params (strict)', () => {
    expect(listOffersQuerySchema.safeParse({ foo: 'bar' }).success).to.be.false;
  });

  it('rejects limit > 100', () => {
    expect(listOffersQuerySchema.safeParse({ limit: '200' }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// offerRowSchema (response)
// ---------------------------------------------------------------------------
describe('Offers: offerRowSchema', () => {
  const validRow = {
    id: 1,
    creator_account_id: 2,
    network_id: 3,
    offer_type: 'SELL',
    token: 'USDC',
    fiat_currency: 'USD',
    min_amount: '10.000000',
    max_amount: '100.000000',
    total_available_amount: '500.000000',
    rate_adjustment: '1.0500',
    terms: 'Cash only',
    escrow_deposit_time_limit: '00:15:00',
    fiat_payment_time_limit: '00:30:00',
    created_at: new Date(),
    updated_at: new Date(),
  };

  it('accepts a valid offer row', () => {
    expect(offerRowSchema.safeParse(validRow).success).to.be.true;
  });

  it('accepts null terms', () => {
    expect(offerRowSchema.safeParse({ ...validRow, terms: null }).success).to.be.true;
  });

  it('accepts string dates', () => {
    expect(
      offerRowSchema.safeParse({
        ...validRow,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      }).success,
    ).to.be.true;
  });

  it('rejects unknown fields (strict)', () => {
    expect(offerRowSchema.safeParse({ ...validRow, extra: true }).success).to.be.false;
  });

  it('rejects missing id', () => {
    const { id: _, ...rest } = validRow;
    expect(offerRowSchema.safeParse(rest).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Wrapped response schemas
// ---------------------------------------------------------------------------
describe('Offers: createOfferResponseSchema', () => {
  const validRow = {
    id: 1,
    creator_account_id: 2,
    network_id: 3,
    offer_type: 'BUY',
    token: 'USDC',
    fiat_currency: 'USD',
    min_amount: '10.000000',
    max_amount: '20.000000',
    total_available_amount: '40.000000',
    rate_adjustment: '1.0500',
    terms: null,
    escrow_deposit_time_limit: '00:15:00',
    fiat_payment_time_limit: '00:30:00',
    created_at: new Date(),
    updated_at: new Date(),
  };

  it('accepts { network, offer }', () => {
    const result = createOfferResponseSchema.safeParse({
      network: 'solana-devnet',
      offer: validRow,
    });
    expect(result.success).to.be.true;
  });

  it('rejects invalid network name', () => {
    expect(createOfferResponseSchema.safeParse({ network: 'invalid', offer: validRow }).success).to
      .be.false;
  });
});

describe('Offers: listOffersResponseSchema', () => {
  it('accepts { network, offers: [] }', () => {
    expect(listOffersResponseSchema.safeParse({ network: 'solana-devnet', offers: [] }).success).to
      .be.true;
  });
});

describe('Offers: deleteOfferResponseSchema', () => {
  it('accepts { message: "Offer deleted" }', () => {
    expect(deleteOfferResponseSchema.safeParse({ message: 'Offer deleted' }).success).to.be.true;
  });

  it('rejects a different message', () => {
    expect(deleteOfferResponseSchema.safeParse({ message: 'Done' }).success).to.be.false;
  });
});
