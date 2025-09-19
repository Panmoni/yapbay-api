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

// Type definitions for Solana event data
interface SolanaEventData {
  seller?: string;
  buyer?: string;
  depositor?: string;
  releaser?: string;
  canceller?: string;
  disputingParty?: string;
  respondingParty?: string;
  tradeId?: number | string;
  trade_id?: number | string;
  escrowId?: number | string;
  escrow_id?: number | string;
  amount?: number | string;
  fee?: number | string;
  arbitrator?: string;
  destination?: string;
  decision?: boolean;
  winner?: string;
  resolutionHash?: Buffer | string;
  defaultingParty?: string;
  sequential?: boolean;
  object_id?: string;
  sequential_escrow_address?: string;
  deposit_deadline?: number | string;
  timestamp?: number | string;
  [key: string]: unknown;
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
  private eventLogIndexTracker: Map<string, number> = new Map(); // Track log_index per transaction

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
            {
              slot: context.slot,
              transaction: {},
              meta: { logMessages: logs.logs },
            } as any,
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

    // Reset log index tracker for this transaction
    this.eventLogIndexTracker.set(signature, 0);

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

    // Clean up old entries from the log index tracker to prevent memory leaks
    // Keep only the last 1000 transaction signatures
    if (this.eventLogIndexTracker.size > 1000) {
      const entries = Array.from(this.eventLogIndexTracker.entries());
      const toDelete = entries.slice(0, entries.length - 1000);
      toDelete.forEach(([signature]) => this.eventLogIndexTracker.delete(signature));
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

      // Check for all event discriminators
      if (eventData.length >= 8) {
        const discriminator = eventData.subarray(0, 8);

        // Check each event type
        for (const [eventName, eventDiscriminator] of Object.entries(EVENT_DISCRIMINATORS)) {
          if (discriminator.equals(eventDiscriminator)) {
            console.log(`✅ Found ${eventName} event via Borsh parsing`);

            // Try to parse the event data with Borsh if available
            let parsedEventData = { raw: eventData.toString('base64') };

            if (this.borshCoder) {
              try {
                // Attempt to decode the event data using Borsh
                const decoded = this.borshCoder.events.decode(eventData.toString('base64'));
                if (decoded) {
                  // Merge decoded data with raw data
                  parsedEventData = {
                    ...decoded,
                    raw: eventData.toString('base64'),
                  };
                  console.log(`📊 Successfully decoded ${eventName} event data`);
                }
              } catch (error) {
                console.log(`⚠️  Failed to decode event data with Borsh: ${error}`);
              }
            }

            await this.processSolanaEvent(eventName, parsedEventData, signature, slot);
            return true;
          }
        }

        console.log(`⚠️  Unknown event discriminator: ${discriminator.toString('hex')}`);
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
    eventData: SolanaEventData,
    signature: string,
    slot: number
  ): Promise<void> {
    try {
      console.log(`🎯 Processing ${eventName} event for ${this.network.name}`);
      console.log(`📝 Signature: ${signature}`);
      console.log(`🎰 Slot: ${slot}`);

      // Extract trade_id from event data if available
      console.log(`🔍 Raw event data structure:`, Object.keys(eventData));
      const tradeIdValue = this.extractTradeId(eventData);

      // Record transaction and capture the returned transaction ID
      // Note: related_trade_id should be null if the trade doesn't exist in our database
      const transactionId = await recordTransaction({
        network_id: this.network.id,
        signature: signature,
        status: 'SUCCESS',
        type: this.mapEventToTransactionType(eventName),
        slot: slot,
        sender_address: this.extractSenderAddress(eventData),
        receiver_or_contract_address: this.extractReceiverAddress(eventName, eventData),
        network_family: 'solana',
        related_trade_id: null, // Always null for Solana events since trades are created separately
      });

      // Serialize event data safely
      const serializedArgs = this.serializeEventData(eventData);

      // Get and increment log index for this transaction
      const currentLogIndex = this.eventLogIndexTracker.get(signature) || 0;
      this.eventLogIndexTracker.set(signature, currentLogIndex + 1);

      console.log(
        `📝 Assigning log_index ${currentLogIndex} to ${eventName} event for transaction ${signature}`
      );

      // Record contract event with all required fields
      await query(
        `
        INSERT INTO contract_events
        (network_id, event_name, block_number, transaction_hash, log_index, args, trade_id, transaction_id)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
        ON CONFLICT (transaction_hash, log_index, network_id) DO NOTHING
      `,
        [
          this.network.id,
          eventName,
          slot, // Use slot as block_number for Solana
          signature, // Use signature as transaction_hash for Solana
          currentLogIndex, // Use sequential log_index for multiple events in same transaction
          serializedArgs,
          tradeIdValue,
          transactionId,
        ]
      );

      console.log(`✅ Recorded ${eventName} event to database`);
      console.log(`📊 Event data: ${JSON.stringify(serializedArgs, null, 2)}`);
      console.log(`🔍 Extracted trade ID: ${tradeIdValue}`);
      fileLog(
        `Recorded ${eventName} event for ${this.network.name}: ${signature}, trade_id: ${tradeIdValue}`
      );

      // Process event-specific logic
      await this.processEventSpecificLogic(eventName, eventData, tradeIdValue, signature, slot);
    } catch (error) {
      console.error(`Error processing Solana event for ${this.network.name}:`, error);
      fileLog(`Error processing Solana event for ${this.network.name}: ${error}`);
    }
  }

  /**
   * Process event-specific logic for different event types
   */
  private async processEventSpecificLogic(
    eventName: string,
    eventData: SolanaEventData,
    tradeIdValue: number | null,
    signature?: string,
    slot?: number
  ): Promise<void> {
    switch (eventName) {
      case 'EscrowCreated':
        await this.handleEscrowCreated(eventData, tradeIdValue, signature, slot);
        break;
      // Add other event-specific handlers here as needed
      default:
        break;
    }
  }

  /**
   * Handle EscrowCreated events by updating the trades table
   * This method waits for the /escrows/record API call to complete first,
   * then uses the escrow ID from that API call to update the trades table
   */
  private async handleEscrowCreated(
    eventData: SolanaEventData,
    tradeIdValue: number | null,
    _signature?: string,
    _slot?: number
  ): Promise<void> {
    if (!tradeIdValue) {
      console.log(`⚠️  EscrowCreated: No trade ID found, skipping trades table update`);
      return;
    }

    try {
      console.log(
        `🔧 EscrowCreated: Waiting for /escrows/record API call to complete for trade_id=${tradeIdValue}`
      );

      // Wait for the escrow record to be created by the /escrows/record API call
      // The API call should happen shortly after the event is detected
      let retries = 0;
      const maxRetries = 10;
      const retryDelay = 1000; // 1 second

      while (retries < maxRetries) {
        // Look for the escrow record that was created for this specific trade
        const escrowResult = await query(
          'SELECT onchain_escrow_id, escrow_address FROM escrows WHERE trade_id = $1 AND network_id = $2',
          [tradeIdValue, this.network.id]
        );

        if (escrowResult.length > 0) {
          // Found the escrow record for this specific trade
          const escrowRecord = escrowResult[0];
          const escrowId = escrowRecord.onchain_escrow_id;
          const escrowAddress = escrowRecord.escrow_address;

          console.log(
            `🔍 Found escrow record: escrow_id=${escrowId}, escrow_address=${escrowAddress}`
          );

          // Get the trade to check if it exists and determine which leg to update
          const tradeResult = await query(
            'SELECT id, leg1_escrow_onchain_id, leg2_escrow_onchain_id FROM trades WHERE id = $1 AND network_id = $2',
            [tradeIdValue, this.network.id]
          );

          if (tradeResult.length === 0) {
            console.log(
              `⚠️  EscrowCreated: Trade ${tradeIdValue} not found for network ${this.network.id}`
            );
            return;
          }

          const trade = tradeResult[0];

          // Update leg1 if it doesn't have an escrow_onchain_id yet
          if (!trade.leg1_escrow_onchain_id) {
            // Update the trades table with both escrow_id and escrow_address
            await query(
              'UPDATE trades SET leg1_escrow_onchain_id = $1, leg1_escrow_address = $2 WHERE id = $3 AND network_id = $4',
              [escrowId, escrowAddress, tradeIdValue, this.network.id]
            );
            console.log(
              `✅ EscrowCreated: Updated trade ${tradeIdValue} leg1_escrow_onchain_id=${escrowId} leg1_escrow_address=${escrowAddress}`
            );
            fileLog(
              `EscrowCreated: Updated trade ${tradeIdValue} leg1_escrow_onchain_id=${escrowId} leg1_escrow_address=${escrowAddress}`
            );
            return;
          } else {
            console.log(
              `⚠️  EscrowCreated: Trade ${tradeIdValue} already has leg1_escrow_onchain_id=${trade.leg1_escrow_onchain_id}, skipping update`
            );
            return;
          }
        }

        // No escrow record found yet, wait and retry
        retries++;
        if (retries < maxRetries) {
          console.log(
            `⏳ EscrowCreated: No escrow record found yet, retrying in ${retryDelay}ms (attempt ${retries}/${maxRetries})`
          );
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }

      console.log(
        `⚠️  EscrowCreated: No escrow record found after ${maxRetries} retries, skipping trades update`
      );
    } catch (error) {
      console.error(`❌ EscrowCreated: Error updating trades table: ${error}`);
      fileLog(`EscrowCreated: Error updating trades table: ${error}`);
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
      case 'EscrowBalanceChanged':
        return 'FUND_ESCROW'; // EscrowBalanceChanged typically happens during funding
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
  private extractSenderAddress(eventData: SolanaEventData): string | undefined {
    // Try to extract sender from common event fields
    if (eventData.seller) return eventData.seller;
    if (eventData.buyer) return eventData.buyer;
    if (eventData.depositor) return eventData.depositor;
    if (eventData.releaser) return eventData.releaser;
    if (eventData.canceller) return eventData.canceller;
    if (eventData.disputingParty) return eventData.disputingParty;
    if (eventData.respondingParty) return eventData.respondingParty;
    if (eventData.arbitrator) return eventData.arbitrator;
    return undefined;
  }

  /**
   * Extract receiver address from event data based on event type
   */
  private extractReceiverAddress(
    eventName: string,
    eventData: SolanaEventData
  ): string | undefined {
    switch (eventName) {
      case 'EscrowReleased':
        // For release, use the destination where funds are actually sent
        return eventData.destination;

      case 'EscrowCancelled':
        // For cancellation, seller gets the refund
        return eventData.seller;

      case 'EscrowCreated':
      case 'FundsDeposited':
      case 'FiatMarkedPaid':
      case 'EscrowBalanceChanged':
      case 'SequentialAddressUpdated':
      case 'DisputeOpened':
      case 'DisputeResponseSubmitted':
      case 'DisputeResolved':
      case 'DisputeDefaultJudgment':
        // For most other events, use the object_id (escrow PDA address)
        return eventData.object_id;

      default:
        // Fallback to program ID if event type is unknown
        return this.programId?.toBase58();
    }
  }

  /**
   * Extract trade ID from event data
   */
  private extractTradeId(eventData: SolanaEventData): number | null {
    try {
      // Try to extract trade_id from common event fields
      if (eventData.tradeId !== undefined) {
        return Number(eventData.tradeId.toString());
      }
      if (eventData.trade_id !== undefined) {
        return Number(eventData.trade_id.toString());
      }

      // For Solana events, try to extract from decoded event data
      if (eventData && typeof eventData === 'object') {
        // Check for nested trade ID fields
        for (const [key, value] of Object.entries(eventData)) {
          if (key.toLowerCase().includes('trade') && typeof value === 'number') {
            return Number(value);
          }
          if (key.toLowerCase().includes('trade') && typeof value === 'bigint') {
            return Number(value.toString());
          }
        }

        // Try to extract from raw base64 data if available
        if (eventData.raw && typeof eventData.raw === 'string') {
          try {
            const rawBuffer = Buffer.from(eventData.raw, 'base64');
            console.log(`🔍 Raw buffer length: ${rawBuffer.length} bytes`);
            console.log(`🔍 Raw buffer hex: ${rawBuffer.toString('hex').substring(0, 64)}...`);

            // Extract trade_id based on event type structure
            // Most events have trade_id at offset 48 bytes (after discriminator + object_id + escrow_id)
            if (rawBuffer.length >= 56) {
              const tradeIdBytes = rawBuffer.subarray(48, 56);
              const tradeId = tradeIdBytes.readBigUInt64LE(0);
              const tradeIdNum = Number(tradeId.toString());

              console.log(`🔍 Extracted trade ID from offset 48: ${tradeIdNum}`);

              // Validate that the trade ID is reasonable
              if (tradeIdNum > 0 && tradeIdNum < 2147483647) {
                console.log(`✅ Found valid trade ID: ${tradeIdNum}`);
                return tradeIdNum;
              } else {
                console.log(`⚠️  Trade ID ${tradeIdNum} is out of range for PostgreSQL integer`);
              }
            }

            console.log(`⚠️  No reasonable trade ID found in binary data`);
            return null;
          } catch (rawError) {
            console.log(`⚠️  Failed to extract trade ID from raw data: ${rawError}`);
          }
        }
      }

      return null;
    } catch (error) {
      console.log(`⚠️  Error extracting trade ID from event data: ${error}`);
      return null;
    }
  }

  /**
   * Safely serialize event data to prevent [object Object] issues
   * This method preserves the good base64 format while handling complex objects
   */
  private serializeEventData(eventData: SolanaEventData): Record<string, unknown> {
    try {
      // If eventData is already a plain object, return it
      if (eventData && typeof eventData === 'object' && !Buffer.isBuffer(eventData)) {
        // Handle common Solana event data structures
        const serialized: Record<string, unknown> = {};

        // Copy all enumerable properties
        for (const [key, value] of Object.entries(eventData)) {
          if (value !== undefined && value !== null) {
            // Handle different value types
            if (typeof value === 'bigint') {
              serialized[key] = value.toString();
            } else if (Buffer.isBuffer(value)) {
              serialized[key] = value.toString('base64');
            } else if (typeof value === 'object' && value.constructor === Object) {
              serialized[key] = this.serializeEventData(value as SolanaEventData);
            } else if (Array.isArray(value)) {
              serialized[key] = value.map(item =>
                typeof item === 'object' ? this.serializeEventData(item as SolanaEventData) : item
              );
            } else {
              serialized[key] = value;
            }
          }
        }

        return serialized;
      }

      // For primitive values or buffers, return as-is or convert
      if (Buffer.isBuffer(eventData)) {
        return { raw: eventData.toString('base64') };
      }

      return eventData;
    } catch (error) {
      console.log(`⚠️  Error serializing event data: ${error}`);
      // Fallback: return a safe representation
      return {
        error: 'Failed to serialize event data',
        type: typeof eventData,
        hasValue: eventData !== undefined && eventData !== null,
      };
    }
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
