import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { NetworkConfig, NetworkFamily, NetworkType } from '../types/networks';
import { NetworkInfo } from '../types/api';

export interface BlockchainService {
  getNetworkFamily(): NetworkFamily;
  validateAddress(address: string): boolean;
  validateTransactionHash(hash: string): boolean;
  getBlockExplorerUrl(txHash: string): string;
  getNetworkInfo(): Promise<NetworkInfo>;
}

export class EVMBlockchainService implements BlockchainService {
  constructor(private network: NetworkConfig) {}

  getNetworkFamily(): NetworkFamily {
    return NetworkFamily.EVM;
  }

  validateAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  validateTransactionHash(hash: string): boolean {
    return ethers.isHexString(hash) && hash.length === 66;
  }

  getBlockExplorerUrl(txHash: string): string {
    if (this.network.name === NetworkType.CELO_ALFAJORES) {
      return `https://alfajores.celoscan.io/tx/${txHash}`;
    }
    return `https://celoscan.io/tx/${txHash}`;
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    // Implementation for EVM network info
    // This would typically connect to the network and get chain info
    return {
      chainId: this.network.chainId,
      name: this.network.name,
    };
  }
}

export class SolanaBlockchainService implements BlockchainService {
  private connection: Connection;

  constructor(private network: NetworkConfig) {
    this.connection = new Connection(network.rpcUrl);
  }

  getNetworkFamily(): NetworkFamily {
    return NetworkFamily.SOLANA;
  }

  validateAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  validateTransactionHash(hash: string): boolean {
    return /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(hash);
  }

  getBlockExplorerUrl(signature: string): string {
    if (this.network.name === NetworkType.SOLANA_DEVNET) {
      return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
    }
    return `https://explorer.solana.com/tx/${signature}`;
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    try {
      const version = await this.connection.getVersion();
      const slot = await this.connection.getSlot();

      return {
        version: version['solana-core'],
        slot: slot,
        name: this.network.name,
      };
    } catch (error) {
      throw new Error(`Failed to get Solana network info: ${error}`);
    }
  }
}

export class BlockchainServiceFactory {
  static create(network: NetworkConfig): BlockchainService {
    switch (network.networkFamily) {
      case NetworkFamily.EVM:
        return new EVMBlockchainService(network);
      case NetworkFamily.SOLANA:
        return new SolanaBlockchainService(network);
      default:
        throw new Error(`Unsupported network family: ${network.networkFamily}`);
    }
  }
}
