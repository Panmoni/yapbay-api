import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { NetworkService } from './networkService';
import { EventParser, BorshCoder } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

export class SolanaService {
  private static connections: Map<number, Connection> = new Map();
  private static keypairs: Map<number, Keypair> = new Map();
  private static eventParsers: Map<number, EventParser> = new Map();
  private static borshCoders: Map<number, BorshCoder> = new Map();

  /**
   * Load a Solana keypair from environment variable or file path
   * Based on the pattern from tests.ts
   */
  static loadKeypair(keypairPath: string): Keypair {
    try {
      // Handle environment variable containing JSON array
      if (keypairPath.startsWith('[') && keypairPath.endsWith(']')) {
        const secretKey = Uint8Array.from(JSON.parse(keypairPath));
        return Keypair.fromSecretKey(secretKey);
      }

      // Handle file path
      const absolutePath = keypairPath.startsWith('~')
        ? path.join(process.env.HOME || process.env.USERPROFILE || '.', keypairPath.slice(1))
        : keypairPath;

      const secretKeyString = fs.readFileSync(absolutePath, 'utf8');
      const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      throw new Error(`Failed to load Solana keypair from ${keypairPath}: ${error}`);
    }
  }

  /**
   * Get Solana connection for a network
   */
  static async getConnectionForNetwork(networkId: number): Promise<Connection> {
    if (this.connections.has(networkId)) {
      return this.connections.get(networkId)!;
    }

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      throw new Error(`Network with ID ${networkId} not found`);
    }

    if (network.networkFamily !== 'solana') {
      throw new Error(`Connection creation not supported for ${network.networkFamily} networks`);
    }

    const connection = new Connection(network.rpcUrl);
    this.connections.set(networkId, connection);

    console.log(`Created Solana connection for ${network.name}: ${network.rpcUrl}`);
    return connection;
  }

  /**
   * Get arbitrator keypair for a network
   */
  static async getArbitratorKeypair(networkId: number): Promise<Keypair> {
    if (this.keypairs.has(networkId)) {
      return this.keypairs.get(networkId)!;
    }

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      throw new Error(`Network with ID ${networkId} not found`);
    }

    if (network.networkFamily !== 'solana') {
      throw new Error(`Arbitrator keypair not supported for ${network.networkFamily} networks`);
    }

    // Get arbitrator keypair from environment
    const arbitratorKeypairEnv = process.env.SOLANA_ARBITRATOR_KEYPAIR;
    if (!arbitratorKeypairEnv) {
      throw new Error(
        `SOLANA_ARBITRATOR_KEYPAIR environment variable not set for network ${network.name}`
      );
    }

    try {
      const keypair = this.loadKeypair(arbitratorKeypairEnv);
      this.keypairs.set(networkId, keypair);

      console.log(`Loaded arbitrator keypair for ${network.name}: ${keypair.publicKey.toBase58()}`);
      return keypair;
    } catch (error) {
      throw new Error(`Failed to load arbitrator keypair for network ${network.name}: ${error}`);
    }
  }

  /**
   * Validate that a keypair can sign transactions
   */
  static async validateKeypair(keypair: Keypair, connection: Connection): Promise<boolean> {
    try {
      // Try to get account info to validate the keypair
      const accountInfo = await connection.getAccountInfo(keypair.publicKey);
      console.log(
        `Keypair validation for ${keypair.publicKey.toBase58()}: ${
          accountInfo ? 'valid' : 'account not found'
        }`
      );
      return true; // If we can query the account, the keypair is valid
    } catch (error) {
      console.error(`Keypair validation failed for ${keypair.publicKey.toBase58()}:`, error);
      return false;
    }
  }

  /**
   * Get event parser for a network
   */
  static async getEventParser(networkId: number): Promise<EventParser> {
    if (this.eventParsers.has(networkId)) {
      return this.eventParsers.get(networkId)!;
    }

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      throw new Error(`Network with ID ${networkId} not found`);
    }

    if (network.networkFamily !== 'solana') {
      throw new Error(`Event parser not supported for ${network.networkFamily} networks`);
    }

    if (!network.programId) {
      throw new Error(`Program ID not configured for network ${network.name}`);
    }

    try {
      // Load IDL from the program (this would need to be available)
      // For now, we'll create a basic event parser
      const programId = new PublicKey(network.programId);
      const borshCoder = await this.getBorshCoder(networkId);
      const eventParser = new EventParser(programId, borshCoder);

      this.eventParsers.set(networkId, eventParser);
      console.log(`Created event parser for ${network.name}`);
      return eventParser;
    } catch (error) {
      throw new Error(`Failed to create event parser for network ${network.name}: ${error}`);
    }
  }

  /**
   * Get BorshCoder for a network
   */
  static async getBorshCoder(networkId: number): Promise<BorshCoder> {
    if (this.borshCoders.has(networkId)) {
      return this.borshCoders.get(networkId)!;
    }

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      throw new Error(`Network with ID ${networkId} not found`);
    }

    if (network.networkFamily !== 'solana') {
      throw new Error(`BorshCoder not supported for ${network.networkFamily} networks`);
    }

    try {
      // TODO: Load actual IDL from the deployed program
      // For now, we'll create a minimal IDL structure
      // In production, this should load the IDL from the program or a file
      const idl = {
        address: network.programId!,
        metadata: { name: 'localsolana_contracts', version: '0.1.0', spec: '0.1.0' },
        instructions: [],
        accounts: [],
        types: [],
        events: [],
      };
      const borshCoder = new BorshCoder(idl);

      this.borshCoders.set(networkId, borshCoder);
      console.log(`Created BorshCoder for ${network.name}`);
      return borshCoder;
    } catch (error) {
      throw new Error(`Failed to create BorshCoder for network ${network.name}: ${error}`);
    }
  }

  /**
   * Clear all cached connections, keypairs, and parsers
   */
  static clearCache(): void {
    this.connections.clear();
    this.keypairs.clear();
    this.eventParsers.clear();
    this.borshCoders.clear();
  }
}
