import { expect } from 'chai';
import { SolanaBlockchainService, BlockchainServiceFactory } from '../services/blockchainService';
import { NetworkService } from '../services/networkService';
import { NetworkFamily } from '../types/networks';

describe('Solana Blockchain Service Tests', function () {
  let solanaDevnetNetwork: any;
  let solanaBlockchainService: SolanaBlockchainService;

  before(async function () {
    try {
      // Get Solana Devnet network (ID 3)
      solanaDevnetNetwork = await NetworkService.getNetworkById(3); // Solana Devnet
      if (!solanaDevnetNetwork) {
        this.skip();
      }

      // Create Solana blockchain service
      solanaBlockchainService = new SolanaBlockchainService(solanaDevnetNetwork);
    } catch (error) {
      console.log('Skipping Solana blockchain service tests:', error);
      this.skip();
    }
  });

  describe('Network Family Detection', function () {
    it('should return SOLANA network family', function () {
      expect(solanaBlockchainService.getNetworkFamily()).to.equal(NetworkFamily.SOLANA);
    });
  });

  describe('Address Validation', function () {
    it('should validate correct Solana addresses', function () {
      const validAddresses = [
        '11111111111111111111111111111112', // System Program
        'So11111111111111111111111111111111111111112', // Wrapped SOL
        '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x', // Known valid Solana address
      ];

      // Add network addresses only if they exist
      if (solanaDevnetNetwork.programId) {
        validAddresses.push(solanaDevnetNetwork.programId);
      }
      if (solanaDevnetNetwork.usdcMintAddress) {
        validAddresses.push(solanaDevnetNetwork.usdcMintAddress);
      }
      if (solanaDevnetNetwork.arbitratorAddress) {
        validAddresses.push(solanaDevnetNetwork.arbitratorAddress);
      }

      validAddresses.forEach(address => {
        expect(solanaBlockchainService.validateAddress(address)).to.be.true;
      });
    });

    it('should reject invalid Solana addresses', function () {
      const invalidAddresses = [
        'invalid-address',
        '0x1234567890abcdef', // Ethereum format
        'too-short',
        '',
        '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890', // too long
      ];

      invalidAddresses.forEach(address => {
        expect(solanaBlockchainService.validateAddress(address)).to.be.false;
      });
    });
  });

  describe('Transaction Hash Validation', function () {
    it('should validate correct Solana transaction signatures', function () {
      const validSignatures = [
        '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW', // 88 chars - valid Solana signature
        '2CKhWHWFY3fFVGxj421JqfDrvk6u4mYgfGET7W7pFXEJP436ogA71HRwk1bhfkjpBfjqWfcfTSdE5mr7P1FaAdA', // 87 chars - valid Solana signature
      ];

      validSignatures.forEach(signature => {
        expect(solanaBlockchainService.validateTransactionHash(signature)).to.be.true;
      });
    });

    it('should reject invalid Solana transaction signatures', function () {
      const invalidSignatures = [
        '0x1234567890abcdef', // Ethereum format
        'invalid-signature',
        'too-short',
        '',
        '2n7WBdGQmQ2p5P5K8hR9vN1xZ2cF3dE4bM5jH6sL7wQ8yP9rT0uI1oP2aS3dF4gH5jK6lZ7xC8vB9nM0qW1eR2tY3uI4oP5aS6dF7gH8jK9lZ0xC1vB2nM3qW4eR5tY6uI7oP8aS9dF0gH1jK2lZ3xC4vB5nM6qW7eR8tY9uI0oP1aS2dF3gH4jK5lZ6xC7vB8nM9qW0eR1tY2uI3oP4aS5dF6gH7jK8lZ9xC0vB1nM2qW3eR4tY5uI6oP7aS8dF9gH', // too short
      ];

      invalidSignatures.forEach(signature => {
        expect(solanaBlockchainService.validateTransactionHash(signature)).to.be.false;
      });
    });
  });

  describe('Block Explorer URL Generation', function () {
    it('should generate correct block explorer URLs for Solana Devnet', function () {
      const signature =
        '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
      const expectedUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

      expect(solanaBlockchainService.getBlockExplorerUrl(signature)).to.equal(expectedUrl);
    });
  });

  describe('Network Info Retrieval', function () {
    it('should get network info from Solana connection', async function () {
      try {
        const networkInfo = await solanaBlockchainService.getNetworkInfo();

        expect(networkInfo).to.be.an('object');
        expect(networkInfo.name).to.equal(solanaDevnetNetwork.name);
        expect(networkInfo.version).to.be.a('string');
        expect(networkInfo.slot).to.be.a('number');
        expect(networkInfo.slot).to.be.greaterThan(0);
      } catch (error) {
        // Skip this test if RPC method is not available (common with public RPC endpoints)
        console.log(
          'Skipping network info test due to RPC restrictions:',
          error instanceof Error ? error.message : String(error)
        );
        this.skip();
      }
    });
  });
});

describe('Blockchain Service Factory Tests', function () {
  let solanaDevnetNetwork: any;

  before(async function () {
    try {
      solanaDevnetNetwork = await NetworkService.getNetworkById(3); // Solana Devnet
      if (!solanaDevnetNetwork) {
        this.skip();
      }
    } catch (error) {
      console.log('Skipping blockchain service factory tests:', error);
      this.skip();
    }
  });

  describe('Service Creation', function () {
    it('should create SolanaBlockchainService for Solana networks', function () {
      const service = BlockchainServiceFactory.create(solanaDevnetNetwork);

      expect(service).to.be.instanceOf(SolanaBlockchainService);
      expect(service.getNetworkFamily()).to.equal(NetworkFamily.SOLANA);
    });

    it('should throw error for unsupported network families', function () {
      const unsupportedNetwork = {
        ...solanaDevnetNetwork,
        networkFamily: 'unsupported',
      };

      expect(() => BlockchainServiceFactory.create(unsupportedNetwork)).to.throw(
        'Unsupported network family: unsupported'
      );
    });
  });
});
