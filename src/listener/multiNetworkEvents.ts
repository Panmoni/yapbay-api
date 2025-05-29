import * as dotenv from 'dotenv';
import { CeloService } from '../celo';
import { query, recordTransaction, TransactionType } from '../db';
import { NetworkService } from '../services/networkService';
import { NetworkConfig } from '../types/networks';
import type { LogDescription, ParamType } from 'ethers';
import fs from 'fs';
import path from 'path';

dotenv.config();

const logFilePath = path.join(process.cwd(), 'events.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function fileLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  logStream.write(line);
}

interface ContractLog {
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  topics: string[];
  data: string;
}

interface ContractInterface {
  interface: {
    parseLog: (log: ContractLog) => LogDescription | null;
  };
}

class NetworkEventListener {
  private network: NetworkConfig;
  private isRunning = false;

  constructor(network: NetworkConfig) {
    this.network = network;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`Event listener for ${this.network.name} is already running`);
      return;
    }

    try {
      const wsProvider = await CeloService.getWsProviderForNetwork(this.network.id);
      const contract = await CeloService.getContractForNetwork(this.network.id, wsProvider);
      
      console.log(`Starting event listener for ${this.network.name} (${this.network.contractAddress})`);
      fileLog(`Starting event listener for ${this.network.name} (${this.network.contractAddress})`);

      // Listen to all logs from this contract
      const filter = { address: this.network.contractAddress };

      wsProvider.on(filter, async (log: ContractLog) => {
        try {
          await this.processEvent(log, contract as unknown as ContractInterface);
        } catch (error) {
          console.error(`Error processing event for ${this.network.name}:`, error);
          fileLog(`Error processing event for ${this.network.name}: ${error}`);
        }
      });

      // Handle WebSocket connection events
      const wsProviderWithConnection = wsProvider as unknown as {
        _websocket?: {
          onclose: (event: { code: number }) => void;
          onerror: (error: { message?: string }) => void;
        };
        ws?: {
          onclose: (event: { code: number }) => void;
          onerror: (error: { message?: string }) => void;
        };
      };

      const rawWs = wsProviderWithConnection._websocket || wsProviderWithConnection.ws;
      if (rawWs) {
        rawWs.onclose = (event: { code: number }) => {
          fileLog(`WebSocket closed for ${this.network.name}: ${event.code}`);
          console.log(`WebSocket closed for ${this.network.name}: ${event.code}`);
          this.isRunning = false;
        };
        rawWs.onerror = (error: { message?: string }) => {
          fileLog(`WebSocket error for ${this.network.name}: ${error.message || error}`);
          console.error(`WebSocket error for ${this.network.name}:`, error);
        };
      }

      this.isRunning = true;
      console.log(`Event listener started for ${this.network.name}`);
    } catch (error) {
      console.error(`Failed to start event listener for ${this.network.name}:`, error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      const wsProvider = await CeloService.getWsProviderForNetwork(this.network.id);
      await wsProvider.removeAllListeners();
      this.isRunning = false;
      console.log(`Event listener stopped for ${this.network.name}`);
    } catch (error) {
      console.error(`Error stopping event listener for ${this.network.name}:`, error);
    }
  }

  private async processEvent(log: ContractLog, contract: ContractInterface): Promise<void> {
    const parsed = contract.interface.parseLog(log);
    if (!parsed) return;

    // Build args object
    const argsObj: Record<string, unknown> = {};
    parsed.fragment.inputs.forEach((input: ParamType, idx: number) => {
      const raw = parsed.args[idx];
      argsObj[input.name] = typeof raw === 'bigint' ? raw.toString() : raw;
    });

    const tradeIdValue = parsed.args.tradeId !== undefined ? Number(parsed.args.tradeId.toString()) : null;

    // Record transaction with network context
    let senderAddress = null;
    let receiverAddress = null;
    
    switch (parsed.name) {
      case 'EscrowCreated':
        senderAddress = parsed.args.seller as string;
        receiverAddress = this.network.contractAddress;
        break;
      case 'FundsDeposited':
        senderAddress = parsed.args.depositor as string;
        receiverAddress = this.network.contractAddress;
        break;
      case 'FiatMarkedPaid':
        senderAddress = parsed.args.buyer as string;
        receiverAddress = parsed.args.seller as string;
        break;
      case 'EscrowReleased':
        senderAddress = parsed.args.releaser as string;
        receiverAddress = parsed.args.seller as string;
        break;
      case 'EscrowCancelled':
        senderAddress = parsed.args.canceller as string;
        receiverAddress = parsed.args.buyer as string;
        break;
      case 'EscrowBalanceChanged':
        senderAddress = this.network.contractAddress;
        receiverAddress = this.network.contractAddress;
        break;
    }
    
    const metadataObj: Record<string, unknown> = {};
    if (parsed.name === 'EscrowCreated' || parsed.name === 'FundsDeposited' || 
        parsed.name === 'FiatMarkedPaid' || parsed.name === 'EscrowReleased' || 
        parsed.name === 'EscrowCancelled') {
      metadataObj.escrow_id = parsed.args.escrowId?.toString();
      metadataObj.network = this.network.name;
      
      if (parsed.args.seller) metadataObj.seller = parsed.args.seller;
      if (parsed.args.buyer) metadataObj.buyer = parsed.args.buyer;
    }

    const transactionId = await recordTransaction({
      transaction_hash: log.transactionHash,
      status: 'SUCCESS',
      type: 'EVENT' as TransactionType,
      block_number: log.blockNumber,
      sender_address: senderAddress,
      receiver_or_contract_address: receiverAddress,
      error_message: Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : null,
      related_trade_id: tradeIdValue,
      network_id: this.network.id
    });

    // Insert event with network context
    const logIndex = log.logIndex !== undefined ? log.logIndex : 0;
    const insertSql = `
      INSERT INTO contract_events
        (event_name, block_number, transaction_hash, log_index, args, trade_id, transaction_id, network_id)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
      ON CONFLICT DO NOTHING;
    `;

    const params = [
      parsed.name,
      log.blockNumber,
      log.transactionHash,
      logIndex,
      JSON.stringify(argsObj),
      tradeIdValue,
      transactionId,
      this.network.id
    ];

    await query(insertSql, params);
    
    console.log(`[${this.network.name}] Logged event ${parsed.name} tx=${log.transactionHash} logIndex=${logIndex}`);
    fileLog(`[${this.network.name}] Logged event ${parsed.name} tx=${log.transactionHash} logIndex=${logIndex} args=${JSON.stringify(argsObj)}`);

    // Process event-specific logic
    await this.processEventSpecificLogic(parsed);
  }

  private async processEventSpecificLogic(parsed: LogDescription): Promise<void> {
    switch (parsed.name) {
      case 'EscrowCreated':
        await this.handleEscrowCreated(parsed);
        break;
      case 'FundsDeposited':
        await this.handleFundsDeposited(parsed);
        break;
      case 'FiatMarkedPaid':
        await this.handleFiatMarkedPaid(parsed);
        break;
      case 'EscrowReleased':
        await this.handleEscrowReleased(parsed);
        break;
      case 'EscrowCancelled':
        await this.handleEscrowCancelled(parsed);
        break;
    }
  }

  private async handleEscrowCreated(parsed: LogDescription): Promise<void> {
    const escrowId = parsed.args.escrowId.toString();
    const tradeId = Number(parsed.args.tradeId.toString());
    const seller = parsed.args.seller as string;
    const buyer = parsed.args.buyer as string;
    const arbitrator = parsed.args.arbitrator as string;
    const amount = parsed.args.amount.toString();
    const amountInDecimal = Number(amount) / 1_000_000;
    const depositTs = Number(parsed.args.deposit_deadline.toString());
    const fiatTs = Number(parsed.args.fiat_deadline.toString());
    const depositDate = new Date(depositTs * 1000);
    const fiatDate = new Date(fiatTs * 1000);
    const sequential = parsed.args.sequential as boolean;
    const seqAddr = parsed.args.sequentialEscrowAddress as string;

    // Check if escrow already exists for this network
    const existingEscrow = await query(
      'SELECT id, state FROM escrows WHERE onchain_escrow_id = $1 AND network_id = $2',
      [escrowId, this.network.id]
    );

    if (existingEscrow.length > 0) {
      if (!['RELEASED', 'CANCELLED', 'RESOLVED'].includes(existingEscrow[0].state)) {
        await query(
          'UPDATE escrows SET deposit_deadline = $1, fiat_deadline = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [depositDate, fiatDate, existingEscrow[0].id]
        );
      }
      return;
    }

    // Create new escrow with network context
    const escrowResult = await query(
      `INSERT INTO escrows (
        trade_id, escrow_address, onchain_escrow_id, seller_address, buyer_address,
        arbitrator_address, amount, current_balance, state, sequential,
        sequential_escrow_address, deposit_deadline, fiat_deadline, network_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'CREATED', $8, $9, $10, $11, $12)
      RETURNING id`,
      [
        tradeId, this.network.contractAddress, escrowId, seller, buyer,
        arbitrator, amountInDecimal, sequential, seqAddr, depositDate, fiatDate, this.network.id
      ]
    );

    const escrowDbId = escrowResult[0].id;

    // Create escrow ID mapping
    await query(
      'INSERT INTO escrow_id_mapping (blockchain_id, database_id, network_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [escrowId, escrowDbId, this.network.id]
    );

    // Update trade with escrow information
    const trade = await query('SELECT * FROM trades WHERE id = $1 AND network_id = $2', [tradeId, this.network.id]);
    if (trade.length > 0) {
      if (!trade[0].leg1_escrow_onchain_id) {
        await query(
          'UPDATE trades SET leg1_escrow_onchain_id = $1, leg1_escrow_address = $2 WHERE id = $3',
          [escrowId, this.network.contractAddress, tradeId]
        );
      } else if (!trade[0].leg2_escrow_onchain_id) {
        await query(
          'UPDATE trades SET leg2_escrow_onchain_id = $1, leg2_escrow_address = $2 WHERE id = $3',
          [escrowId, this.network.contractAddress, tradeId]
        );
      }
    }
  }

  private async handleFundsDeposited(parsed: LogDescription): Promise<void> {
    const escrowId = parsed.args.escrowId.toString();
    const amount = Number(parsed.args.amount.toString()) / 1_000_000;

    await query(
      'UPDATE escrows SET current_balance = $1, state = $2, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $3 AND network_id = $4',
      [amount, 'FUNDED', escrowId, this.network.id]
    );
  }

  private async handleFiatMarkedPaid(parsed: LogDescription): Promise<void> {
    const escrowId = parsed.args.escrowId.toString();

    await query(
      'UPDATE escrows SET fiat_paid = true, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $1 AND network_id = $2',
      [escrowId, this.network.id]
    );
  }

  private async handleEscrowReleased(parsed: LogDescription): Promise<void> {
    const escrowId = parsed.args.escrowId.toString();

    await query(
      'UPDATE escrows SET current_balance = 0, state = $1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND network_id = $3',
      ['RELEASED', escrowId, this.network.id]
    );
  }

  private async handleEscrowCancelled(parsed: LogDescription): Promise<void> {
    const escrowId = parsed.args.escrowId.toString();

    await query(
      'UPDATE escrows SET current_balance = 0, state = $1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND network_id = $3',
      ['CANCELLED', escrowId, this.network.id]
    );
  }

  isListening(): boolean {
    return this.isRunning;
  }
}

export class MultiNetworkEventListener {
  private listeners: Map<number, NetworkEventListener> = new Map();
  private isRunning = false;

  async startAllListeners(): Promise<void> {
    if (this.isRunning) {
      console.log('Multi-network event listener is already running');
      return;
    }

    try {
      const activeNetworks = await NetworkService.getActiveNetworks();
      
      if (activeNetworks.length === 0) {
        throw new Error('No active networks found');
      }

      console.log(`Starting event listeners for ${activeNetworks.length} networks...`);
      fileLog(`Starting event listeners for ${activeNetworks.length} networks`);

      for (const network of activeNetworks) {
        try {
          const listener = new NetworkEventListener(network);
          await listener.start();
          this.listeners.set(network.id, listener);
          console.log(`✅ Started listener for ${network.name}`);
        } catch (error) {
          console.error(`❌ Failed to start listener for ${network.name}:`, error);
          fileLog(`Failed to start listener for ${network.name}: ${error}`);
        }
      }

      this.isRunning = true;
      console.log(`Multi-network event listener started with ${this.listeners.size} active listeners`);
      fileLog(`Multi-network event listener started with ${this.listeners.size} active listeners`);
    } catch (error) {
      console.error('Failed to start multi-network event listener:', error);
      throw error;
    }
  }

  async stopAllListeners(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('Stopping all network event listeners...');
    
    for (const [networkId, listener] of this.listeners) {
      try {
        await listener.stop();
        console.log(`Stopped listener for network ${networkId}`);
      } catch (error) {
        console.error(`Error stopping listener for network ${networkId}:`, error);
      }
    }
    
    this.listeners.clear();
    this.isRunning = false;
    console.log('All network event listeners stopped');
    fileLog('All network event listeners stopped');
  }

  async restartListener(networkId: number): Promise<void> {
    const existingListener = this.listeners.get(networkId);
    if (existingListener) {
      await existingListener.stop();
    }

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    if (!network.isActive) {
      console.log(`Skipping inactive network: ${network.name}`);
      return;
    }

    const newListener = new NetworkEventListener(network);
    await newListener.start();
    this.listeners.set(networkId, newListener);
    
    console.log(`Restarted listener for ${network.name}`);
    fileLog(`Restarted listener for ${network.name}`);
  }

  async getListenerStatus(): Promise<{ networkId: number; networkName: string; isRunning: boolean }[]> {
    const status: { networkId: number; networkName: string; isRunning: boolean }[] = [];
    
    for (const [networkId, listener] of this.listeners) {
      const network = await NetworkService.getNetworkById(networkId);
      status.push({
        networkId,
        networkName: network ? network.name : 'Unknown',
        isRunning: listener.isListening()
      });
    }
    
    return status;
  }

  isListening(): boolean {
    return this.isRunning && this.listeners.size > 0;
  }
}

export function startMultiNetworkEventListener(): MultiNetworkEventListener {
  const multiListener = new MultiNetworkEventListener();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down event listeners...');
    await multiListener.stopAllListeners();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down event listeners...');
    await multiListener.stopAllListeners();
    process.exit(0);
  });

  return multiListener;
}