import { expect } from 'chai';
import {
  escrowAutoCancelResponseSchema,
  escrowBalanceResponseSchema,
  escrowRecordResponseSchema,
  escrowRecordSchemaFor,
  escrowRowSchema,
  evmEscrowRecordSchema,
  listMyEscrowsQuerySchema,
  onchainEscrowIdParamsSchema,
  solanaEscrowRecordSchema,
} from '../../schemas/escrows';

// ---------------------------------------------------------------------------
// Solana escrow record schema
// ---------------------------------------------------------------------------
describe('Escrows: solanaEscrowRecordSchema', () => {
  const validSolana = {
    trade_id: 1,
    signature: `5${'K'.repeat(87)}`,
    escrow_id: '12345',
    seller: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
    buyer: '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
    amount: '50.5',
    program_id: '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
    escrow_pda: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
    escrow_token_account: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
    trade_onchain_id: '999',
  };

  it('accepts a valid Solana escrow record', () => {
    expect(solanaEscrowRecordSchema.safeParse(validSolana).success).to.be.true;
  });

  it('defaults sequential to false', () => {
    const result = solanaEscrowRecordSchema.safeParse(validSolana);
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.sequential).to.be.false;
    }
  });

  it('accepts sequential=true with sequential_escrow_address', () => {
    const withSeq = {
      ...validSolana,
      sequential: true,
      sequential_escrow_address: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
    };
    expect(solanaEscrowRecordSchema.safeParse(withSeq).success).to.be.true;
  });

  it('rejects sequential=true without sequential_escrow_address', () => {
    const withSeq = { ...validSolana, sequential: true };
    expect(solanaEscrowRecordSchema.safeParse(withSeq).success).to.be.false;
  });

  it('rejects missing signature', () => {
    const { signature: _, ...rest } = validSolana;
    expect(solanaEscrowRecordSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects missing program_id', () => {
    const { program_id: _, ...rest } = validSolana;
    expect(solanaEscrowRecordSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects missing escrow_pda', () => {
    const { escrow_pda: _, ...rest } = validSolana;
    expect(solanaEscrowRecordSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects missing trade_onchain_id', () => {
    const { trade_onchain_id: _, ...rest } = validSolana;
    expect(solanaEscrowRecordSchema.safeParse(rest).success).to.be.false;
  });

  it('rejects amount as number (must be string)', () => {
    expect(solanaEscrowRecordSchema.safeParse({ ...validSolana, amount: 50.5 }).success).to.be
      .false;
  });

  it('rejects amount "0" (must be > 0)', () => {
    expect(solanaEscrowRecordSchema.safeParse({ ...validSolana, amount: '0' }).success).to.be.false;
  });

  it('rejects amount "100.000001" (exceeds escrow cap)', () => {
    expect(solanaEscrowRecordSchema.safeParse({ ...validSolana, amount: '100.000001' }).success).to
      .be.false;
  });

  it('accepts amount "100" (at cap)', () => {
    expect(solanaEscrowRecordSchema.safeParse({ ...validSolana, amount: '100' }).success).to.be
      .true;
  });

  it('rejects EVM address as seller', () => {
    expect(
      solanaEscrowRecordSchema.safeParse({
        ...validSolana,
        seller: '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383',
      }).success,
    ).to.be.false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(solanaEscrowRecordSchema.safeParse({ ...validSolana, network_id: 1 }).success).to.be
      .false;
  });
});

// ---------------------------------------------------------------------------
// EVM escrow record schema
// ---------------------------------------------------------------------------
describe('Escrows: evmEscrowRecordSchema', () => {
  const validEvm = {
    trade_id: 1,
    transaction_hash: `0x${'a'.repeat(64)}`,
    escrow_id: '0x1234abcd',
    seller: '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383',
    buyer: '0xf8C832021350133769EE5E0605a9c40c1765ace7',
    amount: '25.5',
  };

  it('accepts a valid EVM escrow record', () => {
    expect(evmEscrowRecordSchema.safeParse(validEvm).success).to.be.true;
  });

  it('rejects a Solana signature in place of transaction_hash', () => {
    const { transaction_hash: _, ...rest } = validEvm;
    expect(
      evmEscrowRecordSchema.safeParse({ ...rest, transaction_hash: `5${'K'.repeat(87)}` }).success,
    ).to.be.false;
  });

  it('rejects Solana address as seller', () => {
    expect(
      evmEscrowRecordSchema.safeParse({
        ...validEvm,
        seller: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
      }).success,
    ).to.be.false;
  });

  it('rejects unknown fields (strict)', () => {
    expect(evmEscrowRecordSchema.safeParse({ ...validEvm, program_id: 'abc' }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
describe('Escrows: escrowRecordSchemaFor', () => {
  it('returns EVM schema for "evm"', () => {
    const schema = escrowRecordSchemaFor('evm');
    const validEvm = {
      trade_id: 1,
      transaction_hash: `0x${'a'.repeat(64)}`,
      escrow_id: '0x1234abcd',
      seller: '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383',
      buyer: '0xf8C832021350133769EE5E0605a9c40c1765ace7',
      amount: '10',
    };
    expect(schema.safeParse(validEvm).success).to.be.true;
  });

  it('returns Solana schema for "solana"', () => {
    const schema = escrowRecordSchemaFor('solana');
    const validSolana = {
      trade_id: 1,
      signature: `5${'K'.repeat(87)}`,
      escrow_id: '12345',
      seller: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
      buyer: '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
      amount: '50',
      program_id: '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
      escrow_pda: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
      escrow_token_account: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
      trade_onchain_id: '999',
    };
    expect(schema.safeParse(validSolana).success).to.be.true;
  });

  it('cross-family: Solana schema rejects EVM payload', () => {
    const schema = escrowRecordSchemaFor('solana');
    const evmPayload = {
      trade_id: 1,
      transaction_hash: `0x${'a'.repeat(64)}`,
      escrow_id: '0x1234abcd',
      seller: '0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383',
      buyer: '0xf8C832021350133769EE5E0605a9c40c1765ace7',
      amount: '10',
    };
    expect(schema.safeParse(evmPayload).success).to.be.false;
  });

  it('cross-family: EVM schema rejects Solana payload', () => {
    const schema = escrowRecordSchemaFor('evm');
    const solanaPayload = {
      trade_id: 1,
      signature: `5${'K'.repeat(87)}`,
      escrow_id: '12345',
      seller: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
      buyer: '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
      amount: '50',
      program_id: '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
      escrow_pda: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
      escrow_token_account: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
      trade_onchain_id: '999',
    };
    expect(schema.safeParse(solanaPayload).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Other schemas
// ---------------------------------------------------------------------------
describe('Escrows: onchainEscrowIdParamsSchema', () => {
  it('accepts valid onchainEscrowId', () => {
    expect(onchainEscrowIdParamsSchema.safeParse({ onchainEscrowId: '123' }).success).to.be.true;
  });

  it('rejects empty onchainEscrowId', () => {
    expect(onchainEscrowIdParamsSchema.safeParse({ onchainEscrowId: '' }).success).to.be.false;
  });

  it('rejects extra params (strict)', () => {
    expect(onchainEscrowIdParamsSchema.safeParse({ onchainEscrowId: '1', foo: 'bar' }).success).to
      .be.false;
  });
});

describe('Escrows: listMyEscrowsQuerySchema', () => {
  it('applies defaults', () => {
    const result = listMyEscrowsQuerySchema.safeParse({});
    expect(result.success).to.be.true;
    if (result.success) {
      expect(result.data.limit).to.equal(25);
    }
  });

  it('rejects unknown query params (strict)', () => {
    expect(listMyEscrowsQuerySchema.safeParse({ foo: 'bar' }).success).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------
describe('Escrows: escrowRecordResponseSchema', () => {
  it('accepts valid response', () => {
    expect(
      escrowRecordResponseSchema.safeParse({
        success: true,
        escrowId: '12345',
        escrowDbId: 1,
        txHash: `5${'K'.repeat(87)}`,
        networkFamily: 'solana',
        blockExplorerUrl: 'https://solscan.io/tx/abc',
      }).success,
    ).to.be.true;
  });

  it('rejects success: false', () => {
    expect(
      escrowRecordResponseSchema.safeParse({
        success: false,
        escrowId: '12345',
        escrowDbId: 1,
        txHash: 'abc',
        networkFamily: 'solana',
        blockExplorerUrl: 'https://solscan.io/tx/abc',
      }).success,
    ).to.be.false;
  });
});

describe('Escrows: escrowRowSchema', () => {
  const validRow = {
    id: 1,
    trade_id: 10,
    network_id: 3,
    escrow_address: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
    seller_address: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
    buyer_address: '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
    arbitrator_address: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
    token_type: 'USDC',
    amount: '50.000000',
    current_balance: null,
    state: 'CREATED',
    sequential: false,
    fiat_paid: false,
    counter: 0,
    network_family: 'solana',
    created_at: new Date(),
    updated_at: new Date(),
  };

  it('accepts a valid escrow row', () => {
    expect(escrowRowSchema.safeParse(validRow).success).to.be.true;
  });

  it('accepts row with all optional Solana fields', () => {
    const full = {
      ...validRow,
      program_id: '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x',
      escrow_pda: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
      escrow_token_account: 'GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr',
      escrow_onchain_id: '12345',
      trade_onchain_id: '999',
      onchain_escrow_id: '12345',
      network: 'solana-devnet',
    };
    expect(escrowRowSchema.safeParse(full).success).to.be.true;
  });

  it('rejects unknown fields (strict)', () => {
    expect(escrowRowSchema.safeParse({ ...validRow, extra: true }).success).to.be.false;
  });
});

describe('Escrows: escrowBalanceResponseSchema', () => {
  it('accepts valid balance response', () => {
    expect(
      escrowBalanceResponseSchema.safeParse({
        network: 'celo-alfajores',
        escrowId: '5',
        balance: '50.000000',
      }).success,
    ).to.be.true;
  });
});

describe('Escrows: escrowAutoCancelResponseSchema', () => {
  it('accepts valid response', () => {
    expect(
      escrowAutoCancelResponseSchema.safeParse({
        escrowId: '5',
        isEligibleForAutoCancel: true,
      }).success,
    ).to.be.true;
  });
});
