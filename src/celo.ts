import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import YapBayEscrowABI from './contract/YapBayEscrow.json';
import { YapBayEscrow } from './types/YapBayEscrow';
import { NetworkService } from './services/networkService';

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.warn('Warning: PRIVATE_KEY not set in environment variables');
}

// Network-aware Celo service
export class CeloService {
  private static providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private static wsProviders: Map<number, ethers.WebSocketProvider> = new Map();
  private static contracts: Map<number, YapBayEscrow> = new Map();

  /**
   * Get JSON RPC provider for a specific network
   */
  static async getProviderForNetwork(networkId: number): Promise<ethers.JsonRpcProvider> {
    if (this.providers.has(networkId)) {
      return this.providers.get(networkId)!;
    }

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      throw new Error(`Network with ID ${networkId} not found`);
    }

    const celoNetwork = {
      name: network.name,
      chainId: network.chainId,
    };

    const provider = new ethers.JsonRpcProvider(network.rpcUrl, celoNetwork);
    this.providers.set(networkId, provider);
    
    console.log(`Created provider for ${network.name}: ${network.rpcUrl}`);
    return provider;
  }

  /**
   * Get WebSocket provider for a specific network
   */
  static async getWsProviderForNetwork(networkId: number): Promise<ethers.WebSocketProvider> {
    if (this.wsProviders.has(networkId)) {
      return this.wsProviders.get(networkId)!;
    }

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      throw new Error(`Network with ID ${networkId} not found`);
    }

    if (!network.wsUrl) {
      throw new Error(`WebSocket URL not configured for network ${network.name}`);
    }

    const celoNetwork = {
      name: network.name,
      chainId: network.chainId,
    };

    const wsProvider = new ethers.WebSocketProvider(network.wsUrl, celoNetwork);
    this.wsProviders.set(networkId, wsProvider);
    
    console.log(`Created WebSocket provider for ${network.name}: ${network.wsUrl}`);
    return wsProvider;
  }

  /**
   * Get contract instance for a specific network
   */
  static async getContractForNetwork(networkId: number, signerOrProvider?: ethers.ContractRunner): Promise<YapBayEscrow> {
    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      throw new Error(`Network with ID ${networkId} not found`);
    }

    const runner = signerOrProvider || await this.getProviderForNetwork(networkId);
    
    return new ethers.Contract(
      network.contractAddress,
      YapBayEscrowABI.abi,
      runner
    ) as unknown as YapBayEscrow;
  }

  /**
   * Get signed contract instance for a specific network
   */
  static async getSignedContractForNetwork(networkId: number): Promise<YapBayEscrow> {
    if (!PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY not set in environment variables');
    }

    const provider = await this.getProviderForNetwork(networkId);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);
    
    return await this.getContractForNetwork(networkId, signer);
  }

  /**
   * Get signer for a specific network
   */
  static async getSignerForNetwork(networkId: number): Promise<ethers.Wallet> {
    if (!PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY not set in environment variables');
    }

    const provider = await this.getProviderForNetwork(networkId);
    return new ethers.Wallet(PRIVATE_KEY, provider);
  }

  /**
   * Utility function to format USDC amounts (6 decimals)
   */
  static formatUSDC(amount: number): bigint {
    return ethers.parseUnits(amount.toString(), 6);
  }

  /**
   * Utility function to parse USDC amounts
   */
  static parseUSDC(amount: bigint): number {
    return Number(ethers.formatUnits(amount, 6));
  }

  /**
   * Get escrow balance for a specific network and escrow ID
   */
  static async getEscrowBalance(networkId: number, escrowId: number): Promise<{stored: string, calculated: string}> {
    const contract = await this.getContractForNetwork(networkId);
    const [stored, calculated] = await Promise.all([
      contract.getStoredEscrowBalance(escrowId),
      contract.getCalculatedEscrowBalance(escrowId)
    ]);
    
    return {
      stored: ethers.formatUnits(stored, 6),
      calculated: ethers.formatUnits(calculated, 6)
    };
  }

  /**
   * Get sequential escrow information
   */
  static async getSequentialInfo(networkId: number, escrowId: number) {
    const contract = await this.getContractForNetwork(networkId);
    const info = await contract.getSequentialEscrowInfo(escrowId);
    
    return {
      isSequential: info.isSequential,
      sequentialAddress: info.sequentialAddress,
      sequentialBalance: ethers.formatUnits(info.sequentialBalance, 6),
      wasReleased: info.wasReleased
    };
  }

  /**
   * Check if escrow is eligible for auto-cancellation
   */
  static async checkAutoCancelEligible(networkId: number, escrowId: number): Promise<boolean> {
    const contract = await this.getContractForNetwork(networkId);
    return await contract.isEligibleForAutoCancel(escrowId);
  }

  /**
   * Clear cached providers and contracts (useful for testing)
   */
  static clearCache(): void {
    this.providers.clear();
    this.wsProviders.clear();
    this.contracts.clear();
  }
}

// Backward compatibility exports - these use the default network
export const getDefaultProvider = async (): Promise<ethers.JsonRpcProvider> => {
  const defaultNetwork = await NetworkService.getDefaultNetwork();
  return CeloService.getProviderForNetwork(defaultNetwork.id);
};

export const getDefaultWsProvider = async (): Promise<ethers.WebSocketProvider> => {
  const defaultNetwork = await NetworkService.getDefaultNetwork();
  return CeloService.getWsProviderForNetwork(defaultNetwork.id);
};

export const getDefaultContract = async (signerOrProvider?: ethers.ContractRunner): Promise<YapBayEscrow> => {
  const defaultNetwork = await NetworkService.getDefaultNetwork();
  return CeloService.getContractForNetwork(defaultNetwork.id, signerOrProvider);
};

export const getDefaultSignedContract = async (): Promise<YapBayEscrow> => {
  const defaultNetwork = await NetworkService.getDefaultNetwork();
  return CeloService.getSignedContractForNetwork(defaultNetwork.id);
};

export const getDefaultSigner = async (): Promise<ethers.Wallet> => {
  const defaultNetwork = await NetworkService.getDefaultNetwork();
  return CeloService.getSignerForNetwork(defaultNetwork.id);
};

// Legacy exports for backward compatibility - these should be replaced with network-aware versions
export { getDefaultProvider as provider };
export { getDefaultWsProvider as wsProvider };
export { getDefaultSigner as getSigner };
export { getDefaultContract as getContract };
export { getDefaultSignedContract as getSignedContract };
export const formatUSDC = CeloService.formatUSDC;
export const parseUSDC = CeloService.parseUSDC;
export const getEscrowBalance = async (escrowId: number) => {
  const defaultNetwork = await NetworkService.getDefaultNetwork();
  return CeloService.getEscrowBalance(defaultNetwork.id, escrowId);
};
export const getSequentialInfo = async (escrowId: number) => {
  const defaultNetwork = await NetworkService.getDefaultNetwork();
  return CeloService.getSequentialInfo(defaultNetwork.id, escrowId);
};
export const checkAutoCancelEligible = async (escrowId: number) => {
  const defaultNetwork = await NetworkService.getDefaultNetwork();
  return CeloService.checkAutoCancelEligible(defaultNetwork.id, escrowId);
};
