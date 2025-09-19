import * as dotenv from 'dotenv';
import { query, recordTransaction, TransactionType } from '../db';
import { NetworkService } from '../services/networkService';
import { NetworkConfig, NetworkFamily } from '../types/networks';
import fs from 'fs';
import path from 'path';
import { SolanaEventListener } from './solanaEvents';

dotenv.config();

const logFilePath = path.join(process.cwd(), 'events.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function fileLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  logStream.write(line);
}

class NetworkEventListener {
  private solanaListener?: SolanaEventListener;
  private network: NetworkConfig;
  private isRunning = false;

  constructor(network: NetworkConfig) {
    this.network = network;

    // Only support Solana networks
    if (network.networkFamily === NetworkFamily.SOLANA) {
      this.solanaListener = new SolanaEventListener(network);
    } else {
      throw new Error(
        `Unsupported network family: ${network.networkFamily}. Only Solana networks are supported.`
      );
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`Event listener for ${this.network.name} is already running`);
      return;
    }

    try {
      if (this.solanaListener) {
        await this.solanaListener.start();
      } else {
        throw new Error('No Solana listener available');
      }

      this.isRunning = true;
      console.log(
        `Event listener started for ${this.network.name} (${this.network.networkFamily})`
      );
      fileLog(`Event listener started for ${this.network.name} (${this.network.networkFamily})`);
    } catch (error) {
      console.error(`Failed to start event listener for ${this.network.name}:`, error);
      fileLog(`Failed to start event listener for ${this.network.name}: ${error}`);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.solanaListener) {
        await this.solanaListener.stop();
      }
      this.isRunning = false;
      console.log(`Event listener stopped for ${this.network.name}`);
      fileLog(`Event listener stopped for ${this.network.name}`);
    } catch (error) {
      console.error(`Error stopping event listener for ${this.network.name}:`, error);
      fileLog(`Error stopping event listener for ${this.network.name}: ${error}`);
    }
  }

  isListening(): boolean {
    return this.isRunning;
  }
}

export class MultiNetworkEventListener {
  private listeners: Map<number, NetworkEventListener> = new Map();

  async startAllListeners(): Promise<void> {
    console.log('🚀 Starting multi-network event listeners...');
    fileLog('🚀 Starting multi-network event listeners...');

    try {
      const networks = await NetworkService.getAllNetworks();
      const activeNetworks = networks.filter(network => network.isActive);

      console.log(`Found ${activeNetworks.length} active networks`);
      fileLog(`Found ${activeNetworks.length} active networks`);

      for (const network of activeNetworks) {
        try {
          console.log(`Starting listener for ${network.name} (${network.networkFamily})`);
          fileLog(`Starting listener for ${network.name} (${network.networkFamily})`);

          const listener = new NetworkEventListener(network);
          await listener.start();
          this.listeners.set(network.id, listener);

          console.log(`✅ Successfully started listener for ${network.name}`);
          fileLog(`✅ Successfully started listener for ${network.name}`);
        } catch (error) {
          console.error(`❌ Failed to start listener for ${network.name}:`, error);
          fileLog(`❌ Failed to start listener for ${network.name}: ${error}`);
          // Continue with other networks even if one fails
        }
      }

      console.log(
        `🎉 Multi-network event listeners startup completed. Active listeners: ${this.listeners.size}`
      );
      fileLog(
        `🎉 Multi-network event listeners startup completed. Active listeners: ${this.listeners.size}`
      );
    } catch (error) {
      console.error('❌ Failed to start multi-network event listeners:', error);
      fileLog(`❌ Failed to start multi-network event listeners: ${error}`);
      throw error;
    }
  }

  async stopAllListeners(): Promise<void> {
    console.log('🛑 Stopping all event listeners...');
    fileLog('🛑 Stopping all event listeners...');

    const stopPromises = Array.from(this.listeners.values()).map(listener =>
      listener.stop().catch(error => {
        console.error('Error stopping listener:', error);
        fileLog(`Error stopping listener: ${error}`);
      })
    );

    await Promise.all(stopPromises);
    this.listeners.clear();

    console.log('✅ All event listeners stopped');
    fileLog('✅ All event listeners stopped');
  }

  getActiveListeners(): NetworkConfig[] {
    return Array.from(this.listeners.values())
      .filter(listener => listener.isListening())
      .map(listener => listener['network']);
  }

  getListenerCount(): number {
    return this.listeners.size;
  }
}

export function startMultiNetworkEventListener(): MultiNetworkEventListener {
  const multiListener = new MultiNetworkEventListener();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Received SIGINT, stopping all listeners...');
    await multiListener.stopAllListeners();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, stopping all listeners...');
    await multiListener.stopAllListeners();
    process.exit(0);
  });

  return multiListener;
}
