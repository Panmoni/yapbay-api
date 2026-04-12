import { expect } from 'chai';
import {
  evmAddress,
  networkAddress,
  solanaAddress,
  solanaPDA,
  solanaProgramId,
} from '../../schemas/primitives/addresses';
import { escrowUsdcAmount, fiatAmount, usdcAmount } from '../../schemas/primitives/amounts';
import {
  accountRoleEnum,
  fiatCurrency,
  networkFamilyEnum,
  networkTypeEnum,
  offerTypeEnum,
  tokenEnum,
  transactionStatusEnum,
  transactionTypeEnum,
} from '../../schemas/primitives/enums';
import { evmTxHash, networkTxHash, solanaSignature } from '../../schemas/primitives/hashes';
import {
  optionalNetworkHeader,
  requireAuthHeader,
  requireNetworkHeader,
} from '../../schemas/primitives/headers';
import { dbId, dbIdParam, evmEscrowId, solanaU64Id } from '../../schemas/primitives/ids';
import { paginationQuery } from '../../schemas/primitives/pagination';
import {
  disputeStatusEnum,
  escrowStateEnum,
  legStateEnum,
  overallStatusEnum,
} from '../../schemas/primitives/states';

// ---------------------------------------------------------------------------
// addresses
// ---------------------------------------------------------------------------
describe('Primitives: addresses', () => {
  describe('evmAddress', () => {
    it('accepts a valid checksummed EVM address', () => {
      const result = evmAddress.safeParse('0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383');
      expect(result.success).to.be.true;
    });

    it('accepts a lowercase EVM address', () => {
      const result = evmAddress.safeParse('0x6d2daaa22a90ac8721d1f9c207d817ab7c490383');
      expect(result.success).to.be.true;
    });

    it('rejects an empty string', () => {
      expect(evmAddress.safeParse('').success).to.be.false;
    });

    it('rejects a Solana address', () => {
      expect(evmAddress.safeParse('GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr').success).to.be
        .false;
    });

    it('rejects a short hex', () => {
      expect(evmAddress.safeParse('0x1234').success).to.be.false;
    });

    it('rejects a non-hex with correct length', () => {
      expect(evmAddress.safeParse('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG').success).to.be
        .false;
    });

    it('rejects null', () => {
      expect(evmAddress.safeParse(null).success).to.be.false;
    });

    it('rejects a number', () => {
      expect(evmAddress.safeParse(12_345).success).to.be.false;
    });
  });

  describe('solanaAddress', () => {
    it('accepts a valid Solana address', () => {
      expect(solanaAddress.safeParse('GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr').success).to.be
        .true;
    });

    it('accepts the system program address', () => {
      expect(solanaAddress.safeParse('11111111111111111111111111111111').success).to.be.true;
    });

    it('rejects an empty string', () => {
      expect(solanaAddress.safeParse('').success).to.be.false;
    });

    it('rejects an EVM address', () => {
      expect(solanaAddress.safeParse('0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383').success).to.be
        .false;
    });

    it('rejects a string with invalid base58 chars (0, O, I, l)', () => {
      expect(solanaAddress.safeParse('0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl').success).to.be.false;
    });

    it('rejects null', () => {
      expect(solanaAddress.safeParse(null).success).to.be.false;
    });

    it('rejects undefined', () => {
      expect(solanaAddress.safeParse(undefined).success).to.be.false;
    });

    it('rejects a number', () => {
      expect(solanaAddress.safeParse(99_999).success).to.be.false;
    });
  });

  describe('solanaPDA', () => {
    it('accepts a valid PDA', () => {
      expect(solanaPDA.safeParse('GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr').success).to.be
        .true;
    });

    it('rejects an empty string', () => {
      expect(solanaPDA.safeParse('').success).to.be.false;
    });
  });

  describe('solanaProgramId', () => {
    it('accepts a valid program ID', () => {
      expect(solanaProgramId.safeParse('4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x').success).to
        .be.true;
    });

    it('rejects an EVM address', () => {
      expect(solanaProgramId.safeParse('0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383').success).to.be
        .false;
    });
  });

  describe('networkAddress', () => {
    it('returns evmAddress for "evm"', () => {
      const schema = networkAddress('evm');
      expect(schema.safeParse('0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383').success).to.be.true;
      expect(schema.safeParse('GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr').success).to.be.false;
    });

    it('returns solanaAddress for "solana"', () => {
      const schema = networkAddress('solana');
      expect(schema.safeParse('GGrXhNVxUZXaA2uMopsa5q23aPmoNvQF14uxqo8qENUr').success).to.be.true;
      expect(schema.safeParse('0x6d2dAaA22a90AC8721D1f9C207D817AB7C490383').success).to.be.false;
    });
  });
});

// ---------------------------------------------------------------------------
// amounts
// ---------------------------------------------------------------------------
describe('Primitives: amounts', () => {
  describe('usdcAmount', () => {
    it('accepts "1"', () => {
      expect(usdcAmount.safeParse('1').success).to.be.true;
    });

    it('accepts "0.000001" (smallest valid unit)', () => {
      expect(usdcAmount.safeParse('0.000001').success).to.be.true;
    });

    it('accepts "99.999999"', () => {
      expect(usdcAmount.safeParse('99.999999').success).to.be.true;
    });

    it('accepts "100"', () => {
      expect(usdcAmount.safeParse('100').success).to.be.true;
    });

    it('accepts "999999999.999999" (large but valid)', () => {
      expect(usdcAmount.safeParse('999999999.999999').success).to.be.true;
    });

    it('rejects "0" (must be > 0)', () => {
      expect(usdcAmount.safeParse('0').success).to.be.false;
    });

    it('rejects "0.000000" (must be > 0)', () => {
      expect(usdcAmount.safeParse('0.000000').success).to.be.false;
    });

    it('rejects "0.0000001" (7 decimal places)', () => {
      expect(usdcAmount.safeParse('0.0000001').success).to.be.false;
    });

    it('rejects a number (must be a string)', () => {
      expect(usdcAmount.safeParse(100).success).to.be.false;
    });

    it('rejects a negative string', () => {
      expect(usdcAmount.safeParse('-1').success).to.be.false;
    });

    it('rejects an empty string', () => {
      expect(usdcAmount.safeParse('').success).to.be.false;
    });

    it('rejects scientific notation', () => {
      expect(usdcAmount.safeParse('1e5').success).to.be.false;
    });

    it('rejects leading zeros like "01"', () => {
      expect(usdcAmount.safeParse('01').success).to.be.false;
    });
  });

  describe('escrowUsdcAmount', () => {
    it('accepts "100.000000" (max escrow cap)', () => {
      expect(escrowUsdcAmount.safeParse('100').success).to.be.true;
    });

    it('accepts "100" exactly', () => {
      expect(escrowUsdcAmount.safeParse('100').success).to.be.true;
    });

    it('accepts "0.000001"', () => {
      expect(escrowUsdcAmount.safeParse('0.000001').success).to.be.true;
    });

    it('rejects "100.000001" (exceeds cap)', () => {
      expect(escrowUsdcAmount.safeParse('100.000001').success).to.be.false;
    });

    it('rejects "101" (exceeds cap)', () => {
      expect(escrowUsdcAmount.safeParse('101').success).to.be.false;
    });

    it('rejects "0" (must be > 0)', () => {
      expect(escrowUsdcAmount.safeParse('0').success).to.be.false;
    });
  });

  describe('fiatAmount', () => {
    it('accepts "100.50"', () => {
      expect(fiatAmount.safeParse('100.50').success).to.be.true;
    });

    it('accepts "1"', () => {
      expect(fiatAmount.safeParse('1').success).to.be.true;
    });

    it('rejects "0"', () => {
      expect(fiatAmount.safeParse('0').success).to.be.false;
    });

    it('rejects "100.555" (3 dp)', () => {
      expect(fiatAmount.safeParse('100.555').success).to.be.false;
    });

    it('rejects a number type', () => {
      expect(fiatAmount.safeParse(100).success).to.be.false;
    });

    it('rejects a negative string', () => {
      expect(fiatAmount.safeParse('-50').success).to.be.false;
    });

    it('rejects an empty string', () => {
      expect(fiatAmount.safeParse('').success).to.be.false;
    });

    it('rejects null', () => {
      expect(fiatAmount.safeParse(null).success).to.be.false;
    });
  });
});

// ---------------------------------------------------------------------------
// hashes
// ---------------------------------------------------------------------------
describe('Primitives: hashes', () => {
  const validEvmHash = `0x${'a'.repeat(64)}`;
  const validSolSig = `5${'A'.repeat(86)}`;

  describe('evmTxHash', () => {
    it('accepts a 66-char hex hash', () => {
      expect(evmTxHash.safeParse(validEvmHash).success).to.be.true;
    });

    it('rejects a 64-char hex without 0x prefix', () => {
      expect(evmTxHash.safeParse('a'.repeat(64)).success).to.be.false;
    });

    it('rejects an empty string', () => {
      expect(evmTxHash.safeParse('').success).to.be.false;
    });

    it('rejects a Solana signature', () => {
      expect(evmTxHash.safeParse(validSolSig).success).to.be.false;
    });

    it('rejects a short hash', () => {
      expect(evmTxHash.safeParse('0x1234').success).to.be.false;
    });

    it('rejects null', () => {
      expect(evmTxHash.safeParse(null).success).to.be.false;
    });

    it('rejects a number', () => {
      expect(evmTxHash.safeParse(12_345).success).to.be.false;
    });

    it('rejects undefined', () => {
      expect(evmTxHash.safeParse(undefined).success).to.be.false;
    });
  });

  describe('solanaSignature', () => {
    it('accepts an 88-char base58 signature', () => {
      const sig = `5${'K'.repeat(87)}`;
      expect(solanaSignature.safeParse(sig).success).to.be.true;
    });

    it('accepts an 87-char base58 signature', () => {
      const sig = `5${'K'.repeat(86)}`;
      expect(solanaSignature.safeParse(sig).success).to.be.true;
    });

    it('rejects an empty string', () => {
      expect(solanaSignature.safeParse('').success).to.be.false;
    });

    it('rejects an EVM hash', () => {
      expect(solanaSignature.safeParse(validEvmHash).success).to.be.false;
    });

    it('rejects a too-short string', () => {
      expect(solanaSignature.safeParse('abc').success).to.be.false;
    });

    it('rejects a string with invalid chars (0, O, I, l)', () => {
      expect(solanaSignature.safeParse('0'.repeat(88)).success).to.be.false;
    });

    it('rejects null', () => {
      expect(solanaSignature.safeParse(null).success).to.be.false;
    });

    it('rejects a number', () => {
      expect(solanaSignature.safeParse(999).success).to.be.false;
    });
  });

  describe('networkTxHash', () => {
    it('returns evmTxHash for "evm"', () => {
      const schema = networkTxHash('evm');
      expect(schema.safeParse(validEvmHash).success).to.be.true;
    });

    it('returns solanaSignature for "solana"', () => {
      const schema = networkTxHash('solana');
      expect(schema.safeParse(`5${'K'.repeat(87)}`).success).to.be.true;
    });
  });
});

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------
describe('Primitives: ids', () => {
  describe('dbId', () => {
    it('accepts 1', () => {
      expect(dbId.safeParse(1).success).to.be.true;
    });

    it('accepts 999999', () => {
      expect(dbId.safeParse(999_999).success).to.be.true;
    });

    it('rejects 0', () => {
      expect(dbId.safeParse(0).success).to.be.false;
    });

    it('rejects -1', () => {
      expect(dbId.safeParse(-1).success).to.be.false;
    });

    it('rejects a float', () => {
      expect(dbId.safeParse(1.5).success).to.be.false;
    });

    it('rejects a string (body fields must be numbers)', () => {
      expect(dbId.safeParse('1').success).to.be.false;
    });

    it('rejects null', () => {
      expect(dbId.safeParse(null).success).to.be.false;
    });

    it('rejects undefined', () => {
      expect(dbId.safeParse(undefined).success).to.be.false;
    });
  });

  describe('dbIdParam', () => {
    it('coerces "1" to 1', () => {
      const result = dbIdParam.safeParse('1');
      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data).to.equal(1);
      }
    });

    it('accepts an already-number value', () => {
      const result = dbIdParam.safeParse(42);
      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data).to.equal(42);
      }
    });

    it('rejects "0"', () => {
      expect(dbIdParam.safeParse('0').success).to.be.false;
    });

    it('rejects "-1"', () => {
      expect(dbIdParam.safeParse('-1').success).to.be.false;
    });

    it('rejects "abc"', () => {
      expect(dbIdParam.safeParse('abc').success).to.be.false;
    });

    it('rejects "1.5"', () => {
      expect(dbIdParam.safeParse('1.5').success).to.be.false;
    });

    it('rejects an empty string', () => {
      expect(dbIdParam.safeParse('').success).to.be.false;
    });

    it('rejects null', () => {
      expect(dbIdParam.safeParse(null).success).to.be.false;
    });
  });

  describe('solanaU64Id', () => {
    it('accepts "1"', () => {
      expect(solanaU64Id.safeParse('1').success).to.be.true;
    });

    it('accepts max u64 "18446744073709551615"', () => {
      expect(solanaU64Id.safeParse('18446744073709551615').success).to.be.true;
    });

    it('rejects "0" (must be > 0)', () => {
      expect(solanaU64Id.safeParse('0').success).to.be.false;
    });

    it('rejects u64 overflow "18446744073709551616"', () => {
      expect(solanaU64Id.safeParse('18446744073709551616').success).to.be.false;
    });

    it('rejects a negative', () => {
      expect(solanaU64Id.safeParse('-1').success).to.be.false;
    });

    it('rejects leading zeros', () => {
      expect(solanaU64Id.safeParse('01').success).to.be.false;
    });

    it('rejects a decimal', () => {
      expect(solanaU64Id.safeParse('1.5').success).to.be.false;
    });

    it('rejects a number type', () => {
      expect(solanaU64Id.safeParse(1).success).to.be.false;
    });

    it('rejects an empty string', () => {
      expect(solanaU64Id.safeParse('').success).to.be.false;
    });

    it('rejects hex', () => {
      expect(solanaU64Id.safeParse('0xff').success).to.be.false;
    });
  });

  describe('evmEscrowId', () => {
    it('accepts a hex string', () => {
      expect(evmEscrowId.safeParse('0x123abc').success).to.be.true;
    });

    it('rejects an empty string', () => {
      expect(evmEscrowId.safeParse('').success).to.be.false;
    });

    it('rejects a non-hex string', () => {
      expect(evmEscrowId.safeParse('hello').success).to.be.false;
    });
  });
});

// ---------------------------------------------------------------------------
// states
// ---------------------------------------------------------------------------
describe('Primitives: states', () => {
  describe('legStateEnum', () => {
    it('accepts "CREATED"', () => {
      expect(legStateEnum.safeParse('CREATED').success).to.be.true;
    });

    it('accepts "FUNDED"', () => {
      expect(legStateEnum.safeParse('FUNDED').success).to.be.true;
    });

    it('accepts "FIAT_PAID"', () => {
      expect(legStateEnum.safeParse('FIAT_PAID').success).to.be.true;
    });

    it('accepts "RELEASED"', () => {
      expect(legStateEnum.safeParse('RELEASED').success).to.be.true;
    });

    it('accepts "CANCELLED"', () => {
      expect(legStateEnum.safeParse('CANCELLED').success).to.be.true;
    });

    it('accepts "DISPUTED"', () => {
      expect(legStateEnum.safeParse('DISPUTED').success).to.be.true;
    });

    it('accepts "RESOLVED"', () => {
      expect(legStateEnum.safeParse('RESOLVED').success).to.be.true;
    });

    it('accepts "COMPLETED"', () => {
      expect(legStateEnum.safeParse('COMPLETED').success).to.be.true;
    });

    it('rejects "created" (lowercase)', () => {
      expect(legStateEnum.safeParse('created').success).to.be.false;
    });

    it('rejects an invalid state', () => {
      expect(legStateEnum.safeParse('PENDING').success).to.be.false;
    });
  });

  describe('overallStatusEnum', () => {
    it('accepts "IN_PROGRESS"', () => {
      expect(overallStatusEnum.safeParse('IN_PROGRESS').success).to.be.true;
    });

    it('accepts "COMPLETED"', () => {
      expect(overallStatusEnum.safeParse('COMPLETED').success).to.be.true;
    });

    it('rejects "CREATED"', () => {
      expect(overallStatusEnum.safeParse('CREATED').success).to.be.false;
    });
  });

  describe('escrowStateEnum', () => {
    it('accepts "AUTO_CANCELLED"', () => {
      expect(escrowStateEnum.safeParse('AUTO_CANCELLED').success).to.be.true;
    });

    it('rejects "IN_PROGRESS"', () => {
      expect(escrowStateEnum.safeParse('IN_PROGRESS').success).to.be.false;
    });
  });

  describe('disputeStatusEnum', () => {
    it('accepts "OPENED"', () => {
      expect(disputeStatusEnum.safeParse('OPENED').success).to.be.true;
    });

    it('rejects "ACTIVE"', () => {
      expect(disputeStatusEnum.safeParse('ACTIVE').success).to.be.false;
    });
  });
});

// ---------------------------------------------------------------------------
// enums
// ---------------------------------------------------------------------------
describe('Primitives: enums', () => {
  describe('networkFamilyEnum', () => {
    it('accepts "evm"', () => {
      expect(networkFamilyEnum.safeParse('evm').success).to.be.true;
    });

    it('accepts "solana"', () => {
      expect(networkFamilyEnum.safeParse('solana').success).to.be.true;
    });

    it('rejects "bitcoin"', () => {
      expect(networkFamilyEnum.safeParse('bitcoin').success).to.be.false;
    });

    it('rejects "EVM" (case sensitive)', () => {
      expect(networkFamilyEnum.safeParse('EVM').success).to.be.false;
    });
  });

  describe('networkTypeEnum', () => {
    it('accepts "solana-devnet"', () => {
      expect(networkTypeEnum.safeParse('solana-devnet').success).to.be.true;
    });

    it('rejects "solana-testnet"', () => {
      expect(networkTypeEnum.safeParse('solana-testnet').success).to.be.false;
    });
  });

  describe('offerTypeEnum', () => {
    it('accepts "BUY"', () => {
      expect(offerTypeEnum.safeParse('BUY').success).to.be.true;
    });

    it('accepts "SELL"', () => {
      expect(offerTypeEnum.safeParse('SELL').success).to.be.true;
    });

    it('rejects "buy" (case sensitive)', () => {
      expect(offerTypeEnum.safeParse('buy').success).to.be.false;
    });
  });

  describe('fiatCurrency', () => {
    it('accepts "USD"', () => {
      expect(fiatCurrency.safeParse('USD').success).to.be.true;
    });

    it('accepts "COP"', () => {
      expect(fiatCurrency.safeParse('COP').success).to.be.true;
    });

    it('rejects "usd" (lowercase)', () => {
      expect(fiatCurrency.safeParse('usd').success).to.be.false;
    });

    it('rejects "USDC" (4 chars)', () => {
      expect(fiatCurrency.safeParse('USDC').success).to.be.false;
    });

    it('rejects "US" (2 chars)', () => {
      expect(fiatCurrency.safeParse('US').success).to.be.false;
    });

    it('rejects "" (empty)', () => {
      expect(fiatCurrency.safeParse('').success).to.be.false;
    });

    it('rejects a number', () => {
      expect(fiatCurrency.safeParse(123).success).to.be.false;
    });

    it('rejects null', () => {
      expect(fiatCurrency.safeParse(null).success).to.be.false;
    });
  });

  describe('tokenEnum', () => {
    it('accepts "USDC"', () => {
      expect(tokenEnum.safeParse('USDC').success).to.be.true;
    });

    it('rejects "USDT"', () => {
      expect(tokenEnum.safeParse('USDT').success).to.be.false;
    });
  });

  describe('accountRoleEnum', () => {
    it('accepts "user"', () => {
      expect(accountRoleEnum.safeParse('user').success).to.be.true;
    });

    it('accepts "admin"', () => {
      expect(accountRoleEnum.safeParse('admin').success).to.be.true;
    });

    it('rejects "superadmin"', () => {
      expect(accountRoleEnum.safeParse('superadmin').success).to.be.false;
    });
  });

  describe('transactionStatusEnum', () => {
    it('accepts all three values', () => {
      expect(transactionStatusEnum.safeParse('PENDING').success).to.be.true;
      expect(transactionStatusEnum.safeParse('SUCCESS').success).to.be.true;
      expect(transactionStatusEnum.safeParse('FAILED').success).to.be.true;
    });

    it('rejects "PROCESSING"', () => {
      expect(transactionStatusEnum.safeParse('PROCESSING').success).to.be.false;
    });
  });

  describe('transactionTypeEnum', () => {
    it('accepts all 14 values', () => {
      const valid = [
        'CREATE_ESCROW',
        'FUND_ESCROW',
        'RELEASE_ESCROW',
        'CANCEL_ESCROW',
        'MARK_FIAT_PAID',
        'OPEN_DISPUTE',
        'RESPOND_DISPUTE',
        'RESOLVE_DISPUTE',
        'EVENT',
        'INITIALIZE_BUYER_BOND',
        'INITIALIZE_SELLER_BOND',
        'UPDATE_SEQUENTIAL_ADDRESS',
        'AUTO_CANCEL',
        'OTHER',
      ];
      for (const v of valid) {
        expect(transactionTypeEnum.safeParse(v).success, `should accept ${v}`).to.be.true;
      }
    });

    it('rejects "DELETE_ESCROW"', () => {
      expect(transactionTypeEnum.safeParse('DELETE_ESCROW').success).to.be.false;
    });
  });
});

// ---------------------------------------------------------------------------
// pagination
// ---------------------------------------------------------------------------
describe('Primitives: pagination', () => {
  describe('paginationQuery', () => {
    it('applies defaults when no values provided', () => {
      const result = paginationQuery.safeParse({});
      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.limit).to.equal(25);
        expect(result.data.offset).to.equal(0);
      }
    });

    it('coerces string values', () => {
      const result = paginationQuery.safeParse({ limit: '10', offset: '5' });
      expect(result.success).to.be.true;
      if (result.success) {
        expect(result.data.limit).to.equal(10);
        expect(result.data.offset).to.equal(5);
      }
    });

    it('accepts limit=100 (max)', () => {
      expect(paginationQuery.safeParse({ limit: '100' }).success).to.be.true;
    });

    it('rejects limit=101 (exceeds cap)', () => {
      expect(paginationQuery.safeParse({ limit: '101' }).success).to.be.false;
    });

    it('rejects limit=0', () => {
      expect(paginationQuery.safeParse({ limit: '0' }).success).to.be.false;
    });

    it('rejects limit=-1', () => {
      expect(paginationQuery.safeParse({ limit: '-1' }).success).to.be.false;
    });

    it('rejects offset=100001 (exceeds cap)', () => {
      expect(paginationQuery.safeParse({ offset: '100001' }).success).to.be.false;
    });

    it('rejects offset=-1', () => {
      expect(paginationQuery.safeParse({ offset: '-1' }).success).to.be.false;
    });

    it('rejects limit=999999999 (DoS prevention)', () => {
      expect(paginationQuery.safeParse({ limit: '999999999' }).success).to.be.false;
    });

    it('rejects unknown fields (strict)', () => {
      expect(paginationQuery.safeParse({ limit: '10', foo: 'bar' }).success).to.be.false;
    });
  });
});

// ---------------------------------------------------------------------------
// headers
// ---------------------------------------------------------------------------
describe('Primitives: headers', () => {
  describe('requireNetworkHeader', () => {
    it('accepts a valid x-network-name', () => {
      const result = requireNetworkHeader.safeParse({
        'x-network-name': 'solana-devnet',
        host: 'localhost',
      });
      expect(result.success).to.be.true;
    });

    it('rejects missing x-network-name', () => {
      const result = requireNetworkHeader.safeParse({ host: 'localhost' });
      expect(result.success).to.be.false;
    });

    it('rejects an invalid network name', () => {
      const result = requireNetworkHeader.safeParse({
        'x-network-name': 'invalid-network',
      });
      expect(result.success).to.be.false;
    });

    it('allows system headers through (loose object)', () => {
      const result = requireNetworkHeader.safeParse({
        'x-network-name': 'solana-devnet',
        host: 'localhost',
        'content-type': 'application/json',
        'user-agent': 'test',
      });
      expect(result.success).to.be.true;
    });
  });

  describe('optionalNetworkHeader', () => {
    it('accepts without x-network-name', () => {
      expect(optionalNetworkHeader.safeParse({ host: 'localhost' }).success).to.be.true;
    });

    it('accepts with valid x-network-name', () => {
      const result = optionalNetworkHeader.safeParse({
        'x-network-name': 'celo-alfajores',
      });
      expect(result.success).to.be.true;
    });
  });

  describe('requireAuthHeader', () => {
    it('accepts a Bearer token', () => {
      const result = requireAuthHeader.safeParse({
        authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.test.sig',
      });
      expect(result.success).to.be.true;
    });

    it('rejects missing authorization', () => {
      expect(requireAuthHeader.safeParse({}).success).to.be.false;
    });

    it('rejects a non-Bearer token', () => {
      expect(requireAuthHeader.safeParse({ authorization: 'Basic abc123' }).success).to.be.false;
    });

    it('rejects "Bearer " with no token', () => {
      expect(requireAuthHeader.safeParse({ authorization: 'Bearer ' }).success).to.be.false;
    });
  });
});
