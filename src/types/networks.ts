export enum NetworkType {
  // EVM Networks
  CELO_ALFAJORES = 'celo-alfajores',
  CELO_MAINNET = 'celo-mainnet',

  // Solana Networks
  SOLANA_DEVNET = 'solana-devnet',
  SOLANA_MAINNET = 'solana-mainnet',
}

export enum NetworkFamily {
  EVM = 'evm',
  SOLANA = 'solana',
}

export interface NetworkConfig {
  arbitratorAddress: string;
  chainId: number;
  contractAddress?: string; // EVM only
  createdAt: Date;
  id: number;
  isActive: boolean;
  isTestnet: boolean;
  name: NetworkType;
  networkFamily: NetworkFamily;
  programId?: string; // Solana only
  rpcUrl: string;
  updatedAt: Date;
  usdcMint?: string; // Solana only
  wsUrl?: string;
}

export interface NetworkContext {
  network: NetworkConfig;
  networkId: number;
}

export interface NetworkRequest {
  network?: NetworkConfig;
  networkId?: number;
}

// Database row interface for networks table
export interface NetworkRow {
  arbitrator_address: string | null;
  chain_id: number;
  contract_address: string | null;
  created_at: Date;
  id: number;
  is_active: boolean;
  is_testnet: boolean;
  name: string;
  network_family: string;
  program_id: string | null;
  rpc_url: string;
  updated_at: Date;
  usdc_mint: string | null;
  ws_url: string | null;
}

// Utility type for network-aware database queries
export interface NetworkFilterOptions {
  includeInactive?: boolean;
  networkId?: number;
  networkName?: NetworkType;
}

// Error types for network operations
export class NetworkNotFoundError extends Error {
  constructor(identifier: string | number) {
    super(`Network not found: ${identifier}`);
    this.name = 'NetworkNotFoundError';
  }
}

export class NetworkInactiveError extends Error {
  constructor(networkName: string) {
    super(`Network is inactive: ${networkName}`);
    this.name = 'NetworkInactiveError';
  }
}

export class InvalidNetworkError extends Error {
  constructor(networkName: string) {
    super(`Invalid network: ${networkName}`);
    this.name = 'InvalidNetworkError';
  }
}
