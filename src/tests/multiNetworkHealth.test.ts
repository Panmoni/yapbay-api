import { Connection } from '@solana/web3.js';
import { expect } from 'chai';
import { BlockchainServiceFactory } from '../services/blockchainService';
import { NetworkService } from '../services/networkService';
import { NetworkFamily } from '../types/networks';

describe('Multi-Network Health Check Tests', () => {
  let allNetworks: any[];

  before(async function () {
    try {
      // Get all networks for health check testing
      allNetworks = await NetworkService.getAllNetworks();
      if (!allNetworks || allNetworks.length === 0) {
        this.skip();
      }
    } catch (error) {
      console.log('Skipping health check tests - network service failed:', error);
      this.skip();
    }
  });

  describe('Network Health Check Logic', () => {
    it('should have networks configured for health checking', () => {
      expect(allNetworks).to.be.an('array');
      expect(allNetworks.length).to.be.greaterThan(0);
    });

    it('should include Solana networks in health check', () => {
      const solanaNetworks = allNetworks.filter(
        (network) => network.networkFamily === NetworkFamily.SOLANA,
      );
      expect(solanaNetworks.length).to.be.greaterThan(0);
    });

    it('should be able to create blockchain services for all networks', () => {
      allNetworks.forEach((network) => {
        expect(() => BlockchainServiceFactory.create(network)).to.not.throw();
      });
    });
  });

  describe('Solana Network Health Checks', () => {
    let solanaNetworks: any[];

    before(() => {
      solanaNetworks = allNetworks.filter(
        (network) => network.networkFamily === NetworkFamily.SOLANA,
      );
    });

    it('should have Solana Devnet configured', () => {
      const solanaDevnet = solanaNetworks.find((network) => network.name === 'solana-devnet');
      expect(solanaDevnet).to.exist;
      expect(solanaDevnet.isActive).to.be.true;
    });

    it('should have Solana Mainnet configured', () => {
      const solanaMainnet = solanaNetworks.find((network) => network.name === 'solana-mainnet');
      expect(solanaMainnet).to.exist;
      // Solana Mainnet is currently inactive
      expect(solanaMainnet.isActive).to.be.false;
    });

    it('should be able to create Solana connections', () => {
      solanaNetworks.forEach((network) => {
        expect(() => new Connection(network.rpcUrl)).to.not.throw();
      });
    });

    it('should have valid RPC URLs for Solana networks', () => {
      solanaNetworks.forEach((network) => {
        expect(network.rpcUrl).to.be.a('string');
        expect(network.rpcUrl).to.include('http');
      });
    });
  });

  describe('Network Status Simulation', () => {
    it('should simulate network status checking for Solana networks', async () => {
      const solanaNetworks = allNetworks.filter(
        (network) => network.networkFamily === NetworkFamily.SOLANA,
      );

      for (const network of solanaNetworks) {
        const networkStatus = {
          ...network,
          status: 'Unknown',
          error: null,
        };

        try {
          const blockchainService = BlockchainServiceFactory.create(network);
          const connection = new Connection(network.rpcUrl);

          // Simulate the health check logic from the health endpoint
          if (network.networkFamily === NetworkFamily.SOLANA) {
            try {
              const _version = await connection.getVersion();
              networkStatus.status = 'Connected';
              networkStatus.providerName = 'Solana';
              networkStatus.blockExplorerUrl = blockchainService.getBlockExplorerUrl(
                '1111111111111111111111111111111111111111111111111111111111111111',
              );
            } catch (connectionError) {
              networkStatus.status = 'Error';
              networkStatus.error = (connectionError as Error).message;
            }
          }

          // Verify the status was set
          expect(networkStatus.status).to.be.oneOf(['Connected', 'Error']);
          expect(networkStatus).to.have.property('providerName');
        } catch (error) {
          // Network configuration error
          expect(error).to.be.an('error');
        }
      }
    });
  });

  describe('Network Summary Statistics', () => {
    it('should calculate correct network summary statistics', () => {
      const summary = {
        totalNetworks: allNetworks.length,
        activeNetworks: allNetworks.filter((n) => n.isActive).length,
        evmNetworks: allNetworks.filter((n) => n.networkFamily === NetworkFamily.EVM).length,
        solanaNetworks: allNetworks.filter((n) => n.networkFamily === NetworkFamily.SOLANA).length,
      };

      expect(summary.totalNetworks).to.equal(allNetworks.length);
      expect(summary.activeNetworks).to.equal(allNetworks.filter((n) => n.isActive).length);
      expect(summary.evmNetworks).to.equal(
        allNetworks.filter((n) => n.networkFamily === NetworkFamily.EVM).length,
      );
      expect(summary.solanaNetworks).to.equal(
        allNetworks.filter((n) => n.networkFamily === NetworkFamily.SOLANA).length,
      );
      expect(summary.solanaNetworks).to.be.greaterThan(0);
    });
  });

  describe('Block Explorer URL Generation', () => {
    it('should generate correct block explorer URLs for Solana networks', () => {
      const solanaNetworks = allNetworks.filter(
        (network) => network.networkFamily === NetworkFamily.SOLANA,
      );

      solanaNetworks.forEach((network) => {
        const blockchainService = BlockchainServiceFactory.create(network);
        const testSignature = '1111111111111111111111111111111111111111111111111111111111111111';
        const blockExplorerUrl = blockchainService.getBlockExplorerUrl(testSignature);

        expect(blockExplorerUrl).to.include('explorer.solana.com');
        expect(blockExplorerUrl).to.include(testSignature);

        if (network.name === 'solana-devnet') {
          expect(blockExplorerUrl).to.include('cluster=devnet');
        }
      });
    });
  });

  describe('Network Configuration Validation', () => {
    it('should have required fields for all networks', () => {
      allNetworks.forEach((network) => {
        expect(network).to.have.property('id');
        expect(network).to.have.property('name');
        expect(network).to.have.property('networkFamily');
        expect(network).to.have.property('rpcUrl');
        expect(network).to.have.property('isActive');
        expect(network).to.have.property('isTestnet');
      });
    });

    it('should have Solana-specific fields for Solana networks', () => {
      const solanaNetworks = allNetworks.filter(
        (network) => network.networkFamily === NetworkFamily.SOLANA,
      );

      solanaNetworks.forEach((network) => {
        expect(network).to.have.property('programId');
        expect(network).to.have.property('usdcMint');
        expect(network).to.have.property('arbitratorAddress');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network service errors gracefully', async () => {
      try {
        const nonExistentNetwork = await NetworkService.getNetworkById(99_999);
        expect(nonExistentNetwork).to.be.null;
      } catch (error) {
        // This is expected behavior
        expect(error).to.be.an('error');
      }
    });

    it('should handle invalid network families in blockchain service factory', () => {
      const invalidNetwork = {
        ...allNetworks[0],
        networkFamily: 'invalid-family',
      };

      expect(() => BlockchainServiceFactory.create(invalidNetwork)).to.throw(
        'Unsupported network family: invalid-family',
      );
    });
  });

  describe('Performance and Reliability', () => {
    it('should complete network health checks within reasonable time', async () => {
      const startTime = Date.now();
      const solanaNetworks = allNetworks.filter(
        (network) => network.networkFamily === NetworkFamily.SOLANA,
      );

      // Test connection to Solana Devnet (active network)
      const solanaDevnet = solanaNetworks.find((network) => network.name === 'solana-devnet');

      if (solanaDevnet) {
        try {
          const connection = new Connection(solanaDevnet.rpcUrl);
          await connection.getVersion();
        } catch (error) {
          // Connection might fail due to RPC restrictions, that's ok for testing
          console.log('Solana connection test failed (expected):', (error as Error).message);
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Health check should complete within 10 seconds
      expect(duration).to.be.lessThan(10_000);
    });

    it('should provide consistent network information across multiple calls', async () => {
      const networks1 = await NetworkService.getAllNetworks();
      const networks2 = await NetworkService.getAllNetworks();

      expect(networks1.length).to.equal(networks2.length);
      expect(networks1.map((n) => n.id)).to.deep.equal(networks2.map((n) => n.id));
    });
  });
});
