import { expect } from 'chai';
import {
  recordTransactionRequestSchema,
  recordTransactionResponseSchema,
  transactionLookupRowSchema,
  transactionTradeIdParamsSchema,
  transactionTradeQuerySchema,
  transactionUserQuerySchema,
} from '../../schemas/transactions';

// ---------------------------------------------------------------------------
// recordTransactionRequestSchema
// ---------------------------------------------------------------------------
describe('Transactions: recordTransactionRequestSchema', () => {
  const validWithHash = {
    trade_id: 1,
    transaction_hash: `0x${'a'.repeat(64)}`,
    transaction_type: 'FUND_ESCROW' as const,
    from_address: '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383',
  };

  const validWithSig = {
    trade_id: 1,
    signature: `5${'K'.repeat(87)}`,
    transaction_type: 'FUND_ESCROW' as const,
    from_address: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
  };

  it('accepts with transaction_hash (EVM)', () => {
    expect(recordTransactionRequestSchema.safeParse(validWithHash).success).to.be.true;
  });

  it('accepts with signature (Solana)', () => {
    expect(recordTransactionRequestSchema.safeParse(validWithSig).success).to.be.true;
  });

  it('defaults status to PENDING', () => {
    const result = recordTransactionRequestSchema.safeParse(validWithHash);
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.status).to.equal('PENDING');
    }
  });

  it('accepts all transaction types including DISPUTE_ESCROW', () => {
    const types = [
      'CREATE_ESCROW',
      'FUND_ESCROW',
      'RELEASE_ESCROW',
      'CANCEL_ESCROW',
      'MARK_FIAT_PAID',
      'OPEN_DISPUTE',
      'RESPOND_DISPUTE',
      'RESOLVE_DISPUTE',
      'DISPUTE_ESCROW',
      'OTHER',
    ];
    for (const t of types) {
      expect(
        recordTransactionRequestSchema.safeParse({ ...validWithHash, transaction_type: t }).success,
        `should accept ${t}`,
      ).to.be.true;
    }
  });

  it('accepts metadata as object', () => {
    expect(
      recordTransactionRequestSchema.safeParse({
        ...validWithHash,
        metadata: { action: 'MARK_FIAT_PAID' },
      }).success,
    ).to.be.true;
  });

  it('accepts metadata as string', () => {
    expect(
      recordTransactionRequestSchema.safeParse({
        ...validWithHash,
        metadata: '{"action":"MARK_FIAT_PAID"}',
      }).success,
    ).to.be.true;
  });

  it('accepts escrow_id as string', () => {
    expect(recordTransactionRequestSchema.safeParse({ ...validWithHash, escrow_id: '123' }).success)
      .to.be.true;
  });

  it('accepts escrow_id as number', () => {
    expect(recordTransactionRequestSchema.safeParse({ ...validWithHash, escrow_id: 123 }).success)
      .to.be.true;
  });

  it('rejects missing both transaction_hash and signature', () => {
    expect(
      recordTransactionRequestSchema.safeParse({
        trade_id: 1,
        transaction_type: 'FUND_ESCROW',
        from_address: '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383',
      }).success,
    ).to.be.false;
  });

  it('rejects missing trade_id', () => {
    const { trade_id: _, ...rest } = validWithHash;
    expect(recordTransactionRequestSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects missing transaction_type', () => {
    const { transaction_type: _, ...rest } = validWithHash;
    expect(recordTransactionRequestSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects missing from_address', () => {
    const { from_address: _, ...rest } = validWithHash;
    expect(recordTransactionRequestSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects invalid transaction_type', () => {
    expect(
      recordTransactionRequestSchema.safeParse({
        ...validWithHash,
        transaction_type: 'DELETE_ESCROW',
      }).success,
    ).to.be.false;
  });

  it('rejects invalid status', () => {
    expect(
      recordTransactionRequestSchema.safeParse({ ...validWithHash, status: 'PROCESSING' }).success,
    ).to.be.false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(recordTransactionRequestSchema.safeParse({ ...validWithHash, network_id: 1 }).success).to
      .be.false;
  });

  it('rejects trade_id as string', () => {
    expect(recordTransactionRequestSchema.safeParse({ ...validWithHash, trade_id: '1' }).success).to
      .be.false;
  });
});

// ---------------------------------------------------------------------------
// Query / params schemas
// ---------------------------------------------------------------------------
describe('Transactions: transactionTradeIdParamsSchema', () => {
  it('coerces "5" to { id: 5 }', () => {
    const result = transactionTradeIdParamsSchema.safeParse({ id: '5' });
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.id).to.equal(5);
    }
  });

  it('rejects "abc"', () => {
    expect(transactionTradeIdParamsSchema.safeParse({ id: 'abc' }).success).to.be.false;
  });
});

describe('Transactions: transactionTradeQuerySchema', () => {
  it('accepts empty query', () => {
    expect(transactionTradeQuerySchema.safeParse({}).success).to.be.true;
  });

  it('accepts type filter', () => {
    expect(transactionTradeQuerySchema.safeParse({ type: 'FUND_ESCROW' }).success).to.be.true;
  });

  it('rejects unknown query params (strict)', () => {
    expect(transactionTradeQuerySchema.safeParse({ foo: 'bar' }).success).to.be.false;
  });
});

describe('Transactions: transactionUserQuerySchema', () => {
  it('applies pagination defaults', () => {
    const result = transactionUserQuerySchema.safeParse({});
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.limit).to.equal(25);
      expect(result.data.offset).to.equal(0);
    }
  });

  it('accepts type filter with pagination', () => {
    expect(transactionUserQuerySchema.safeParse({ type: 'CREATE_ESCROW', limit: '10' }).success).to
      .be.true;
  });

  it('rejects unknown query params (strict)', () => {
    expect(transactionUserQuerySchema.safeParse({ status: 'SUCCESS' }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------
describe('Transactions: recordTransactionResponseSchema', () => {
  it('accepts valid response', () => {
    expect(
      recordTransactionResponseSchema.safeParse({
        success: true,
        transactionId: 42,
        txHash: `0x${'a'.repeat(64)}`,
        blockNumber: null,
      }).success,
    ).to.be.true;
  });

  it('rejects success: false', () => {
    expect(
      recordTransactionResponseSchema.safeParse({
        success: false,
        transactionId: 42,
        txHash: 'abc',
        blockNumber: null,
      }).success,
    ).to.be.false;
  });

  it('rejects extra fields (strict)', () => {
    expect(
      recordTransactionResponseSchema.safeParse({
        success: true,
        transactionId: 42,
        txHash: 'abc',
        blockNumber: null,
        extra: true,
      }).success,
    ).to.be.false;
  });
});

describe('Transactions: transactionLookupRowSchema', () => {
  const validRow = {
    id: 1,
    transaction_hash: `0x${'a'.repeat(64)}`,
    status: 'SUCCESS',
    transaction_type: 'FUND_ESCROW',
    from_address: '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383',
    to_address: null,
    gas_used: null,
    error_message: null,
    trade_id: 10,
    escrow_id: null,
    created_at: new Date(),
    metadata: null,
    network: 'solana-devnet',
  };

  it('accepts a valid lookup row', () => {
    expect(transactionLookupRowSchema.safeParse(validRow).success).to.be.true;
  });

  it('accepts id as string (BIGSERIAL can come as string from pg)', () => {
    expect(transactionLookupRowSchema.safeParse({ ...validRow, id: '12345' }).success).to.be.true;
  });

  it('accepts with metadata object', () => {
    expect(
      transactionLookupRowSchema.safeParse({ ...validRow, metadata: { action: 'test' } }).success,
    ).to.be.true;
  });

  it('accepts string dates', () => {
    expect(
      transactionLookupRowSchema.safeParse({
        ...validRow,
        created_at: '2025-01-01T00:00:00.000Z',
      }).success,
    ).to.be.true;
  });
});
