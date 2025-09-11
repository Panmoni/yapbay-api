import { expect } from 'chai';
import { NetworkService } from '../services/networkService';
import { NetworkType, NetworkFamily } from '../types/networks';
import { Connection, PublicKey } from '@solana/web3.js';

describe('Solana Network Tests', function () {
  let solanaDevnetNetwork: any;
  let solanaMainnetNetwork: any;

  before(async function () {
    this.timeout(10000);

    try {
      // Get Solana network configurations
      solanaDevnetNetwork = await NetworkService.getNetworkByName(NetworkType.SOLANA_DEVNET);
      solanaMainnetNetwork = await NetworkService.getNetworkByName(NetworkType.SOLANA_MAINNET);

      if (!solanaDevnetNetwork || !solanaMainnetNetwork) {
        throw new Error('Solana networks not properly configured');
      }
    } catch (error) {
      console.error('Failed to setup Solana networks:', error);
      this.skip();
    }
  });

  describe('Solana Network Configuration', function () {
    it('should have Solana Devnet configured', function () {
      expect(solanaDevnetNetwork).to.not.be.null;
      expect(solanaDevnetNetwork.name).to.equal(NetworkType.SOLANA_DEVNET);
      expect(solanaDevnetNetwork.networkFamily).to.equal(NetworkFamily.SOLANA);
      expect(solanaDevnetNetwork.isTestnet).to.be.true;
    });

    it('should have Solana Mainnet configured', function () {
      expect(solanaMainnetNetwork).to.not.be.null;
      expect(solanaMainnetNetwork.name).to.equal(NetworkType.SOLANA_MAINNET);
      expect(solanaMainnetNetwork.networkFamily).to.equal(NetworkFamily.SOLANA);
      expect(solanaMainnetNetwork.isTestnet).to.be.false;
    });

    it('should have valid Solana RPC URLs', function () {
      expect(solanaDevnetNetwork.rpcUrl).to.be.a('string');
      expect(solanaDevnetNetwork.rpcUrl).to.include('solana');

      expect(solanaMainnetNetwork.rpcUrl).to.be.a('string');
      expect(solanaMainnetNetwork.rpcUrl).to.include('solana');
    });

    it('should have valid program IDs', function () {
      // Only test devnet since mainnet is not active yet
      expect(solanaDevnetNetwork.programId).to.be.a('string');
      expect(solanaDevnetNetwork.programId.length).to.equal(44); // Base58 encoded public key
      expect(solanaDevnetNetwork.programId).to.equal(
        '4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x'
      );
    });

    it('should have valid USDC mint addresses', function () {
      expect(solanaDevnetNetwork.usdcMint).to.be.a('string');
      expect(solanaDevnetNetwork.usdcMint.length).to.equal(44);

      expect(solanaMainnetNetwork.usdcMint).to.be.a('string');
      expect(solanaMainnetNetwork.usdcMint.length).to.equal(44);
    });

    it('should have valid arbitrator addresses', function () {
      expect(solanaDevnetNetwork.arbitratorAddress).to.be.a('string');
      expect(solanaDevnetNetwork.arbitratorAddress.length).to.equal(44);

      expect(solanaMainnetNetwork.arbitratorAddress).to.be.a('string');
      expect(solanaMainnetNetwork.arbitratorAddress.length).to.equal(44);
    });
  });

  describe('Solana RPC Connection', function () {
    it('should connect to Solana Devnet', async function () {
      this.timeout(15000);

      const connection = new Connection(solanaDevnetNetwork.rpcUrl);
      const version = await connection.getVersion();

      expect(version).to.have.property('solana-core');
      expect(version['solana-core']).to.be.a('string');
    });

    it('should connect to Solana Mainnet', async function () {
      this.timeout(15000);

      const connection = new Connection(solanaMainnetNetwork.rpcUrl);
      const version = await connection.getVersion();

      expect(version).to.have.property('solana-core');
      expect(version['solana-core']).to.be.a('string');
    });

    it('should get current slot from Solana Devnet', async function () {
      this.timeout(15000);

      const connection = new Connection(solanaDevnetNetwork.rpcUrl);
      const slot = await connection.getSlot();

      expect(slot).to.be.a('number');
      expect(slot).to.be.greaterThan(0);
    });
  });

  describe('Solana Address Validation', function () {
    it('should validate Solana program IDs', function () {
      // Test valid program ID - only test devnet since mainnet is not active yet
      expect(() => new PublicKey(solanaDevnetNetwork.programId)).to.not.throw();
    });

    it('should validate Solana USDC mint addresses', function () {
      // Test valid USDC mint
      expect(() => new PublicKey(solanaDevnetNetwork.usdcMint)).to.not.throw();
      expect(() => new PublicKey(solanaMainnetNetwork.usdcMint)).to.not.throw();
    });

    it('should validate Solana arbitrator addresses', function () {
      // Test valid arbitrator address
      expect(() => new PublicKey(solanaDevnetNetwork.arbitratorAddress)).to.not.throw();
      expect(() => new PublicKey(solanaMainnetNetwork.arbitratorAddress)).to.not.throw();
    });

    it('should reject invalid Solana addresses', function () {
      const invalidAddresses = [
        'invalid-address',
        '0x1234567890123456789012345678901234567890', // EVM address
        'too-short',
        '1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111', // Too long
      ];

      invalidAddresses.forEach(address => {
        expect(() => new PublicKey(address)).to.throw();
      });
    });
  });

  describe('Network Service Integration', function () {
    it('should get Solana networks by family', async function () {
      const solanaNetworks = await NetworkService.getSolanaNetworks();

      expect(solanaNetworks).to.be.an('array');
      expect(solanaNetworks.length).to.be.greaterThan(0);

      solanaNetworks.forEach(network => {
        expect(network.networkFamily).to.equal(NetworkFamily.SOLANA);
      });
    });

    it('should get default network as Solana Devnet in development', async function () {
      const defaultNetwork = await NetworkService.getDefaultNetwork();

      expect(defaultNetwork.networkFamily).to.equal(NetworkFamily.SOLANA);
      expect(defaultNetwork.isTestnet).to.be.true;
    });

    it('should get network family correctly', async function () {
      const devnetFamily = await NetworkService.getNetworkFamily(solanaDevnetNetwork.id);
      const mainnetFamily = await NetworkService.getNetworkFamily(solanaMainnetNetwork.id);

      expect(devnetFamily).to.equal(NetworkFamily.SOLANA);
      expect(mainnetFamily).to.equal(NetworkFamily.SOLANA);
    });
  });

  describe('Network Status', function () {
    it('should have Solana Devnet as active', function () {
      expect(solanaDevnetNetwork.isActive).to.be.true;
    });

    it('should have Solana Mainnet as inactive (for now)', function () {
      expect(solanaMainnetNetwork.isActive).to.be.false;
    });
  });
});
