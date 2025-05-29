export enum NetworkType {
  CELO_ALFAJORES = 'celo-alfajores',
  CELO_MAINNET = 'celo-mainnet'
}

export interface NetworkConfig {
  id: number;
  name: NetworkType;
  chainId: number;
  rpcUrl: string;
  wsUrl?: string;
  contractAddress: string;
  isTestnet: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NetworkContext {
  networkId: number;
  network: NetworkConfig;
}

export interface NetworkRequest {
  network?: NetworkConfig;
  networkId?: number;
}

// Database row interface for networks table
export interface NetworkRow {
  id: number;
  name: string;
  chain_id: number;
  rpc_url: string;
  ws_url: string | null;
  contract_address: string;
  is_testnet: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Utility type for network-aware database queries
export interface NetworkFilterOptions {
  networkId?: number;
  networkName?: NetworkType;
  includeInactive?: boolean;
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