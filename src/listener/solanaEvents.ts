import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { NetworkConfig } from '../types/networks';
import { query, recordTransaction, TransactionType } from '../db';
import { SolanaService } from '../services/solanaService';
import { EventParser, BorshCoder } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

const logFilePath = path.join(process.cwd(), 'events.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function fileLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  logStream.write(line);
}

// Event discriminators from the IDL
const EVENT_DISCRIMINATORS = {
  EscrowCreated: Buffer.from([70, 127, 105, 102, 92, 97, 7, 173]),
  FiatMarkedPaid: Buffer.from([38, 159, 7, 17, 32, 79, 143, 184]),
  EscrowReleased: Buffer.from([131, 7, 138, 104, 166, 190, 113, 112]),
  EscrowCancelled: Buffer.from([98, 241, 195, 122, 213, 0, 162, 161]),
  FundsDeposited: Buffer.from([157, 209, 100, 95, 59, 100, 3, 68]),
  DisputeOpened: Buffer.from([239, 222, 102, 235, 193, 85, 1, 214]),
  DisputeResponseSubmitted: Buffer.from([22, 179, 0, 219, 181, 109, 45, 5]),
  DisputeResolved: Buffer.from([121, 64, 249, 153, 139, 128, 236, 187]),
  DisputeDefaultJudgment: Buffer.from([194, 12, 130, 224, 60, 204, 39, 194]),
  EscrowBalanceChanged: Buffer.from([169, 241, 33, 44, 253, 206, 89, 168]),
  SequentialAddressUpdated: Buffer.from([205, 6, 123, 144, 102, 253, 81, 133]),
};

export class SolanaEventListener {
  private network: NetworkConfig;
  private connection: Connection;
  private isRunning = false;
  private programId?: PublicKey;
  private eventParser?: EventParser;
  private borshCoder?: BorshCoder;
  private subscriptionId: number | null = null;
  private processedEvents: Set<string> = new Set();

  constructor(network: NetworkConfig) {
    this.network = network;
    this.connection = new Connection(network.rpcUrl);

    // Set program ID if available
    if (network.programId) {
      this.programId = new PublicKey(network.programId);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`Solana event listener for ${this.network.name} is already running`);
      return;
    }

    try {
      console.log(`Starting Solana event listener for ${this.network.name}`);
      fileLog(`Starting Solana event listener for ${this.network.name}`);

      // Validate network configuration
      if (!this.network.programId) {
        console.log(
          `⚠️  No program ID configured for ${this.network.name} - event monitoring disabled`
        );
        this.isRunning = true; // Mark as running but not actively monitoring
        return;
      }

      // Test connection and program ID
      try {
        const programInfo = await this.connection.getAccountInfo(this.programId!);
        if (!programInfo) {
          console.log(
            `⚠️  Program ${this.programId!.toBase58()} not found on ${
              this.network.name
            } - event monitoring disabled`
          );
          this.isRunning = true; // Mark as running but not actively monitoring
          return;
        }
        console.log(`✅ Program ${this.programId!.toBase58()} found on ${this.network.name}`);
      } catch (error) {
        console.log(
          `⚠️  Failed to validate program ${this.programId!.toBase58()} on ${
            this.network.name
          }: ${error}`
        );
        this.isRunning = true; // Mark as running but not actively monitoring
        return;
      }

      // Initialize event parsing utilities
      try {
        this.eventParser = await SolanaService.getEventParser(this.network.id);
        this.borshCoder = await SolanaService.getBorshCoder(this.network.id);
        console.log(`✅ Event parsing utilities initialized for ${this.network.name}`);
      } catch (error) {
        console.log(`⚠️  Failed to initialize event parsing utilities: ${error}`);
        // Continue without full event parsing - we can still detect transactions
      }

      // Start real-time event monitoring
      this.subscriptionId = this.connection.onLogs(
        this.programId!,
        (logs, context) => {
          this.parseTransactionLogs(
            { slot: context.slot, meta: { logMessages: logs.logs } } as any,
            logs.signature
          );
        },
        'confirmed'
      );

      this.isRunning = true;
      console.log(`✅ Solana event listener started for ${this.network.name} - monitoring enabled`);
      fileLog(`Solana event listener started for ${this.network.name} - monitoring enabled`);
    } catch (error) {
      console.error(`Failed to start Solana event listener for ${this.network.name}:`, error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.subscriptionId !== null) {
        await this.connection.removeOnLogsListener(this.subscriptionId);
        this.subscriptionId = null;
      }

      this.isRunning = false;
      console.log(`Solana event listener stopped for ${this.network.name}`);
      fileLog(`Solana event listener stopped for ${this.network.name}`);
    } catch (error) {
      console.error(`Error stopping Solana event listener for ${this.network.name}:`, error);
    }
  }

  isListening(): boolean {
    return this.isRunning;
  }

  /**
   * Parse transaction logs for events
   */
  private async parseTransactionLogs(
    tx: ParsedTransactionWithMeta,
    signature: string
  ): Promise<void> {
    if (!tx.meta || !tx.meta.logMessages) return;

    const logs = tx.meta.logMessages;
    const slot = tx.slot;

    console.log(`🔍 Parsing transaction ${signature} with ${logs.length} logs`);

    // Create unique key for this transaction to prevent duplicate processing
    const eventKey = `${signature}-${slot}`;
    if (this.processedEvents.has(eventKey)) {
      console.log(`⚠️  Transaction already processed, skipping`);
      return;
    }

    let eventFound = false;

    // Try to parse all logs first with the event parser
    if (this.eventParser) {
      try {
        const events = this.eventParser.parseLogs(logs);

        for (const event of events) {
          console.log(`✅ Found event: ${event.name}`);
          await this.processSolanaEvent(event.name, event.data, signature, slot);
          eventFound = true;
        }
      } catch (error) {
        console.log(`⚠️  Error parsing events from logs: ${error}`);
      }
    }

    // If no events found with Anchor parser, try manual Borsh parsing
    if (!eventFound) {
      for (const log of logs) {
        if (log.includes('Program data:')) {
          console.log(`📋 Found program data log: ${log.substring(0, 100)}...`);
          const manualEvent = await this.tryBorshEventParsing(log, signature, slot);
          if (manualEvent) {
            eventFound = true;
          }
        }
      }
    }

    // Mark as processed if we found any events
    if (eventFound) {
      this.processedEvents.add(eventKey);
    }
  }

  /**
   * Borsh-based event parsing
   */
  private async tryBorshEventParsing(
    log: string,
    signature: string,
    slot: number
  ): Promise<boolean> {
    try {
      const base64Data = log.split('Program data: ')[1];
      if (!base64Data) return false;

      const eventData = Buffer.from(base64Data, 'base64');
      console.log(
        `🔍 Borsh parsing event data (${eventData.length} bytes): ${eventData
          .toString('hex')
          .substring(0, 32)}...`
      );

      // Check for EscrowCreated discriminator
      if (eventData.length >= 8) {
        const discriminator = eventData.subarray(0, 8);
        const escrowCreatedDiscriminator = EVENT_DISCRIMINATORS.EscrowCreated;

        if (discriminator.equals(escrowCreatedDiscriminator)) {
          console.log(`✅ Found EscrowCreated event via Borsh parsing`);
          await this.processSolanaEvent('EscrowCreated', { raw: eventData }, signature, slot);
          return true;
        }
      }
    } catch (error) {
      console.log(`⚠️  Borsh parsing failed: ${error}`);
    }
    return false;
  }

  /**
   * Process Solana events and record to database
   */
  private async processSolanaEvent(
    eventName: string,
    eventData: any,
    signature: string,
    slot: number
  ): Promise<void> {
    try {
      console.log(`🎯 Processing ${eventName} event for ${this.network.name}`);
      console.log(`📝 Signature: ${signature}`);
      console.log(`🎰 Slot: ${slot}`);

      // Record transaction
      await recordTransaction({
        network_id: this.network.id,
        signature: signature,
        status: 'SUCCESS',
        type: this.mapEventToTransactionType(eventName),
        slot: slot,
        sender_address: this.extractSenderAddress(eventData),
        receiver_or_contract_address: this.programId?.toBase58(),
        network_family: 'solana',
      });

      // Record contract event
      await query(
        `
        INSERT INTO contract_events
        (network_id, event_name, block_number, transaction_hash, log_index, args)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
        [
          this.network.id,
          eventName,
          slot, // Use slot as block_number for Solana
          signature, // Use signature as transaction_hash for Solana
          0, // log_index (Solana doesn't have log index, use 0)
          JSON.stringify(eventData),
        ]
      );

      console.log(`✅ Recorded ${eventName} event to database`);
      fileLog(`Recorded ${eventName} event for ${this.network.name}: ${signature}`);
    } catch (error) {
      console.error(`Error processing Solana event for ${this.network.name}:`, error);
      fileLog(`Error processing Solana event for ${this.network.name}: ${error}`);
    }
  }

  /**
   * Map event names to transaction types
   */
  private mapEventToTransactionType(eventName: string): TransactionType {
    switch (eventName) {
      case 'EscrowCreated':
        return 'CREATE_ESCROW';
      case 'FiatMarkedPaid':
        return 'MARK_FIAT_PAID';
      case 'EscrowReleased':
        return 'RELEASE_ESCROW';
      case 'EscrowCancelled':
        return 'CANCEL_ESCROW';
      case 'FundsDeposited':
        return 'FUND_ESCROW';
      case 'DisputeOpened':
        return 'OPEN_DISPUTE';
      case 'DisputeResponseSubmitted':
        return 'RESPOND_DISPUTE';
      case 'DisputeResolved':
        return 'RESOLVE_DISPUTE';
      default:
        return 'EVENT';
    }
  }

  /**
   * Extract sender address from event data
   */
  private extractSenderAddress(eventData: any): string | undefined {
    // Try to extract sender from common event fields
    if (eventData.seller) return eventData.seller;
    if (eventData.buyer) return eventData.buyer;
    if (eventData.disputingParty) return eventData.disputingParty;
    if (eventData.respondingParty) return eventData.respondingParty;
    return undefined;
  }

  /**
   * Get network connection for external use
   */
  async getConnection(): Promise<Connection> {
    return this.connection;
  }

  /**
   * Get program ID for external use
   */
  getProgramId(): PublicKey | undefined {
    return this.programId;
  }
}
