import { query } from '../db';
import {
  NetworkConfig,
  NetworkType,
  NetworkFamily,
  NetworkRow,
  NetworkNotFoundError,
  NetworkInactiveError,
  InvalidNetworkError,
} from '../types/networks';

export class NetworkService {
  private static networkCache: Map<number, NetworkConfig> = new Map();
  private static networkNameCache: Map<NetworkType, NetworkConfig> = new Map();
  private static cacheExpiry = 5 * 60 * 1000; // 5 minutes
  private static lastCacheUpdate = 0;

  /**
   * Convert database row to NetworkConfig
   */
  private static rowToConfig(row: NetworkRow): NetworkConfig {
    return {
      id: row.id,
      name: row.name as NetworkType,
      chainId: row.chain_id,
      rpcUrl: row.rpc_url,
      wsUrl: row.ws_url || undefined,
      contractAddress: row.contract_address || undefined,
      programId: row.program_id || undefined,
      usdcMint: row.usdc_mint || undefined,
      arbitratorAddress: row.arbitrator_address || '',
      isTestnet: row.is_testnet,
      isActive: row.is_active,
      networkFamily: row.network_family as NetworkFamily,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Load networks from database and update cache
   */
  private static async loadNetworks(): Promise<void> {
    const rows = await query('SELECT * FROM networks ORDER BY id');

    this.networkCache.clear();
    this.networkNameCache.clear();

    for (const row of rows) {
      const config = this.rowToConfig(row as NetworkRow);
      this.networkCache.set(config.id, config);
      this.networkNameCache.set(config.name, config);
    }

    this.lastCacheUpdate = Date.now();
  }

  /**
   * Ensure cache is fresh
   */
  private static async ensureFreshCache(): Promise<void> {
    if (Date.now() - this.lastCacheUpdate > this.cacheExpiry) {
      await this.loadNetworks();
    }
  }

  /**
   * Get network by ID
   */
  static async getNetworkById(id: number): Promise<NetworkConfig | null> {
    await this.ensureFreshCache();
    return this.networkCache.get(id) || null;
  }

  /**
   * Get network by name
   */
  static async getNetworkByName(name: NetworkType | string): Promise<NetworkConfig | null> {
    await this.ensureFreshCache();

    // Handle string input
    if (typeof name === 'string') {
      if (!Object.values(NetworkType).includes(name as NetworkType)) {
        return null;
      }
      name = name as NetworkType;
    }

    return this.networkNameCache.get(name as NetworkType) || null;
  }

  /**
   * Get all active networks
   */
  static async getActiveNetworks(): Promise<NetworkConfig[]> {
    await this.ensureFreshCache();
    return Array.from(this.networkCache.values()).filter(n => n.isActive);
  }

  /**
   * Get all networks (including inactive)
   */
  static async getAllNetworks(): Promise<NetworkConfig[]> {
    await this.ensureFreshCache();
    return Array.from(this.networkCache.values());
  }

  /**
   * Get networks by family
   */
  static async getNetworksByFamily(family: NetworkFamily): Promise<NetworkConfig[]> {
    await this.ensureFreshCache();
    return Array.from(this.networkCache.values()).filter(n => n.networkFamily === family);
  }

  /**
   * Get Solana networks
   */
  static async getSolanaNetworks(): Promise<NetworkConfig[]> {
    return this.getNetworksByFamily(NetworkFamily.SOLANA);
  }

  /**
   * Get EVM networks
   */
  static async getEVMNetworks(): Promise<NetworkConfig[]> {
    return this.getNetworksByFamily(NetworkFamily.EVM);
  }

  /**
   * Get network family for a given network ID
   */
  static async getNetworkFamily(networkId: number): Promise<NetworkFamily> {
    const network = await this.getNetworkById(networkId);
    return network.networkFamily;
  }

  /**
   * Get the default network (Solana Devnet for development, Solana Mainnet for production)
   */
  static async getDefaultNetwork(): Promise<NetworkConfig> {
    const isProduction = process.env.NODE_ENV === 'production';
    const defaultNetworkName = isProduction
      ? NetworkType.SOLANA_MAINNET
      : NetworkType.SOLANA_DEVNET;

    const network = await this.getNetworkByName(defaultNetworkName);
    if (!network) {
      throw new NetworkNotFoundError(defaultNetworkName);
    }

    return network;
  }

  /**
   * Get network from request headers
   */
  static async getNetworkFromRequest(req: {
    headers: { [key: string]: string | string[] | undefined };
  }): Promise<NetworkConfig> {
    const networkName = req.headers['x-network-name'] as string;

    if (!networkName) {
      // Return default network if no header specified
      return await this.getDefaultNetwork();
    }

    const network = await this.getNetworkByName(networkName);
    if (!network) {
      throw new InvalidNetworkError(networkName);
    }

    if (!network.isActive) {
      throw new NetworkInactiveError(networkName);
    }

    return network;
  }

  /**
   * Validate network exists and is active
   */
  static async validateNetwork(networkId: number): Promise<NetworkConfig> {
    const network = await this.getNetworkById(networkId);
    if (!network) {
      throw new NetworkNotFoundError(networkId.toString());
    }

    if (!network.isActive) {
      throw new NetworkInactiveError(network.name);
    }

    return network;
  }

  /**
   * Create a new network (admin only)
   */
  static async createNetwork(
    config: Omit<NetworkConfig, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<NetworkConfig> {
    const result = await query(
      `
      INSERT INTO networks (name, chain_id, rpc_url, ws_url, contract_address, is_testnet, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
      [
        config.name,
        config.chainId,
        config.rpcUrl,
        config.wsUrl || null,
        config.contractAddress,
        config.isTestnet,
        config.isActive,
      ]
    );

    // Clear cache to force reload
    this.lastCacheUpdate = 0;

    return this.rowToConfig(result[0] as NetworkRow);
  }

  /**
   * Update network configuration (admin only)
   */
  static async updateNetwork(
    id: number,
    updates: Partial<Omit<NetworkConfig, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<NetworkConfig | null> {
    const setClauses: string[] = [];
    const values: (string | number | boolean)[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.chainId !== undefined) {
      setClauses.push(`chain_id = $${paramIndex++}`);
      values.push(updates.chainId);
    }
    if (updates.rpcUrl !== undefined) {
      setClauses.push(`rpc_url = $${paramIndex++}`);
      values.push(updates.rpcUrl);
    }
    if (updates.wsUrl !== undefined) {
      setClauses.push(`ws_url = $${paramIndex++}`);
      values.push(updates.wsUrl);
    }
    if (updates.contractAddress !== undefined) {
      setClauses.push(`contract_address = $${paramIndex++}`);
      values.push(updates.contractAddress);
    }
    if (updates.isTestnet !== undefined) {
      setClauses.push(`is_testnet = $${paramIndex++}`);
      values.push(updates.isTestnet);
    }
    if (updates.isActive !== undefined) {
      setClauses.push(`is_active = $${paramIndex++}`);
      values.push(updates.isActive);
    }

    if (setClauses.length === 0) {
      return await this.getNetworkById(id);
    }

    values.push(id);
    const result = await query(
      `
      UPDATE networks 
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex}
      RETURNING *
    `,
      values
    );

    if (result.length === 0) {
      return null;
    }

    // Clear cache to force reload
    this.lastCacheUpdate = 0;

    return this.rowToConfig(result[0] as NetworkRow);
  }

  /**
   * Deactivate a network (soft delete)
   */
  static async deactivateNetwork(id: number): Promise<boolean> {
    await query(
      `
      UPDATE networks 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
      [id]
    );

    // Clear cache to force reload
    this.lastCacheUpdate = 0;

    // query() returns an array, so we assume success if no error was thrown
    return true;
  }

  /**
   * Clear cache (useful for testing or manual cache invalidation)
   */
  static clearCache(): void {
    this.networkCache.clear();
    this.networkNameCache.clear();
    this.lastCacheUpdate = 0;
  }

  /**
   * Get network statistics (number of offers, trades, etc.)
   */
  static async getNetworkStats(networkId: number): Promise<{
    offers: number;
    trades: number;
    escrows: number;
    transactions: number;
  }> {
    const [offersResult, tradesResult, escrowsResult, transactionsResult] = await Promise.all([
      query('SELECT COUNT(*) as count FROM offers WHERE network_id = $1', [networkId]),
      query('SELECT COUNT(*) as count FROM trades WHERE network_id = $1', [networkId]),
      query('SELECT COUNT(*) as count FROM escrows WHERE network_id = $1', [networkId]),
      query('SELECT COUNT(*) as count FROM transactions WHERE network_id = $1', [networkId]),
    ]);

    return {
      offers: parseInt(offersResult[0].count),
      trades: parseInt(tradesResult[0].count),
      escrows: parseInt(escrowsResult[0].count),
      transactions: parseInt(transactionsResult[0].count),
    };
  }
}
