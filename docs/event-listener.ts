#!/usr/bin/env ts-node

/**
 * Solana Event Listener for Escrow Contract
 *
 * This script listens for events from the escrow contract and outputs them to console.
 * It can catch both past events (by scanning recent transactions) and upcoming events
 * (by subscribing to program logs).
 *
 * Usage:
 *   npm run event-listener [hours]
 *   # or
 *   ts-node scripts/event-listener.ts [hours]
 *
 * Examples:
 *   npm run event-listener 1    # Scan last 1 hour of blocks
 *   npm run event-listener 24   # Scan last 24 hours of blocks
 *   npm run event-listener      # Default: scan last 1 hour of blocks
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, ParsedTransactionWithMeta } from "@solana/web3.js";
import * as dotenv from "dotenv";
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { LocalsolanaContracts } from "../target/types/localsolana_contracts";

dotenv.config();

// Program configuration
const PROGRAM_ID = new PublicKey("4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x");
const RPC_ENDPOINT = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";

// Block timing configuration
const BLOCKS_PER_SECOND = 2; // 0.5 seconds per block = 2 blocks per second
const SECONDS_PER_HOUR = 3600;

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
  SequentialAddressUpdated: Buffer.from([205, 6, 123, 144, 102, 253, 81, 133])
};

/**
 * Convert hours to number of blocks
 */
function hoursToBlocks(hours: number): number {
  return Math.ceil(hours * SECONDS_PER_HOUR * BLOCKS_PER_SECOND);
}

class EventListener {
  private connection: Connection;
  private eventParser: EventParser;
  private borshCoder: BorshCoder;
  private isListening: boolean = false;
  private subscriptionId: number | null = null;
  private processedEvents: Set<string> = new Set();
  private scanHours: number;

  constructor(scanHours: number = 1) {
    this.connection = new Connection(RPC_ENDPOINT, "confirmed");
    this.scanHours = scanHours;

    // Create event parser using the program's IDL
    const idl = require("../target/idl/localsolana_contracts.json");
    this.borshCoder = new BorshCoder(idl);
    this.eventParser = new EventParser(PROGRAM_ID, this.borshCoder);
  }

  /**
   * Format USDC amounts for display
   */
  private formatUsdcAmount(amount: number): string {
    return (amount / 1_000_000).toFixed(2) + " USDC";
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toISOString();
  }

  /**
   * Convert value to number (handles both decimal strings and hex strings)
   */
  private hexToNumber(value: string | number): number {
    if (!value) return 0;
    if (typeof value === 'number') return value;

    // If it's already a decimal number as string, parse it directly
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }

    // If it's a hex string, convert it
    if (/^[0-9a-fA-F]+$/.test(value)) {
      // Convert hex to buffer, reverse for little-endian, then parse
      const buffer = Buffer.from(value, 'hex');
      const reversed = Buffer.from(buffer.reverse());
      return parseInt(reversed.toString('hex'), 16);
    }

    return 0;
  }

  /**
   * Parse and display an event
   */
  private displayEvent(eventName: string, eventData: any, signature: string, slot: number) {
    console.log("\n" + "=".repeat(80));
    console.log(`🎯 EVENT: ${eventName}`);
    console.log(`📝 Signature: ${signature}`);
    console.log(`🎰 Slot: ${slot}`);
    console.log(`⏰ Time: ${new Date().toISOString()}`);
    console.log("-".repeat(80));

    // Handle different event data structures - some have nested 'data' property
    const data = eventData.data || eventData;

    switch (eventName) {
      case "EscrowCreated":
        // Convert hex strings to numbers for amounts and IDs
        const escrowId = this.hexToNumber(data.escrow_id);
        const tradeId = this.hexToNumber(data.trade_id);
        const amount = this.hexToNumber(data.amount);
        const fee = this.hexToNumber(data.fee);
        const depositDeadline = this.hexToNumber(data.deposit_deadline);
        const timestamp = this.hexToNumber(data.timestamp);


        console.log(`🆔 Escrow ID: ${escrowId}`);
        console.log(`🔄 Trade ID: ${tradeId}`);
        console.log(`👤 Seller: ${data.seller}`);
        console.log(`👤 Buyer: ${data.buyer}`);
        console.log(`⚖️  Arbitrator: ${data.arbitrator}`);
        console.log(`💰 Amount: ${this.formatUsdcAmount(amount)}`);
        console.log(`💸 Fee: ${this.formatUsdcAmount(fee)}`);
        console.log(`⏳ Deposit Deadline: ${this.formatTimestamp(depositDeadline)}`);
        console.log(`🔄 Sequential: ${data.sequential ? "Yes" : "No"}`);
        if (data.sequential_escrow_address) {
          console.log(`🔗 Sequential Address: ${data.sequential_escrow_address}`);
        }
        console.log(`⏰ Timestamp: ${this.formatTimestamp(timestamp)}`);
        break;

      case "FiatMarkedPaid":
        console.log(`🆔 Escrow ID: ${eventData.escrowId.toString()}`);
        console.log(`🔄 Trade ID: ${eventData.tradeId.toString()}`);
        console.log(`✅ Fiat payment marked as completed`);
        break;

      case "EscrowReleased":
        console.log(`🆔 Escrow ID: ${eventData.escrowId.toString()}`);
        console.log(`🔄 Trade ID: ${eventData.tradeId.toString()}`);
        console.log(`👤 Buyer: ${eventData.buyer.toBase58()}`);
        console.log(`💰 Amount: ${this.formatUsdcAmount(eventData.amount.toNumber())}`);
        console.log(`💸 Fee: ${this.formatUsdcAmount(eventData.fee.toNumber())}`);
        console.log(`🎯 Destination: ${eventData.destination.toBase58()}`);
        break;

      case "EscrowCancelled":
        console.log(`🆔 Escrow ID: ${eventData.escrowId.toString()}`);
        console.log(`🔄 Trade ID: ${eventData.tradeId.toString()}`);
        console.log(`👤 Seller: ${eventData.seller.toBase58()}`);
        console.log(`💰 Amount: ${this.formatUsdcAmount(eventData.amount.toNumber())}`);
        console.log(`💸 Fee: ${this.formatUsdcAmount(eventData.fee.toNumber())}`);
        break;

      case "FundsDeposited":
        console.log(`🆔 Escrow ID: ${eventData.escrowId.toString()}`);
        console.log(`🔄 Trade ID: ${eventData.tradeId.toString()}`);
        console.log(`💰 Amount: ${this.formatUsdcAmount(eventData.amount.toNumber())}`);
        console.log(`💸 Fee: ${this.formatUsdcAmount(eventData.fee.toNumber())}`);
        console.log(`🔢 Counter: ${eventData.counter.toString()}`);
        break;

      case "DisputeOpened":
        console.log(`🆔 Escrow ID: ${eventData.escrowId.toString()}`);
        console.log(`🔄 Trade ID: ${eventData.tradeId.toString()}`);
        console.log(`👤 Disputing Party: ${eventData.disputingParty.toBase58()}`);
        console.log(`🔐 Evidence Hash: ${Buffer.from(eventData.evidenceHash).toString('hex')}`);
        console.log(`💰 Bond Amount: ${this.formatUsdcAmount(eventData.bondAmount.toNumber())}`);
        break;

      case "DisputeResponseSubmitted":
        console.log(`🆔 Escrow ID: ${eventData.escrowId.toString()}`);
        console.log(`🔄 Trade ID: ${eventData.tradeId.toString()}`);
        console.log(`👤 Responding Party: ${eventData.respondingParty.toBase58()}`);
        console.log(`🔐 Evidence Hash: ${Buffer.from(eventData.evidenceHash).toString('hex')}`);
        console.log(`💰 Bond Amount: ${this.formatUsdcAmount(eventData.bondAmount.toNumber())}`);
        break;

      case "DisputeResolved":
        console.log(`🆔 Escrow ID: ${eventData.escrowId.toString()}`);
        console.log(`🔄 Trade ID: ${eventData.tradeId.toString()}`);
        console.log(`⚖️  Decision: ${eventData.decision ? "Buyer Wins" : "Seller Wins"}`);
        console.log(`👑 Winner: ${eventData.winner.toBase58()}`);
        console.log(`💸 Fee: ${this.formatUsdcAmount(eventData.fee.toNumber())}`);
        console.log(`🔐 Resolution Hash: ${Buffer.from(eventData.resolutionHash).toString('hex')}`);
        break;

      case "DisputeDefaultJudgment":
        console.log(`🆔 Escrow ID: ${eventData.escrowId.toString()}`);
        console.log(`🔄 Trade ID: ${eventData.tradeId.toString()}`);
        console.log(`👤 Defaulting Party: ${eventData.defaultingParty.toBase58()}`);
        console.log(`⚖️  Decision: ${eventData.decision ? "Buyer Wins" : "Seller Wins"}`);
        break;

      case "EscrowBalanceChanged":
        console.log(`🆔 Escrow ID: ${eventData.escrowId.toString()}`);
        console.log(`🔄 Trade ID: ${eventData.tradeId.toString()}`);
        console.log(`💰 New Balance: ${this.formatUsdcAmount(eventData.newBalance.toNumber())}`);
        console.log(`📝 Reason: ${eventData.reason}`);
        break;

      case "SequentialAddressUpdated":
        console.log(`🆔 Escrow ID: ${eventData.escrowId.toString()}`);
        console.log(`🔄 Trade ID: ${eventData.tradeId.toString()}`);
        if (eventData.oldAddress) {
          console.log(`🔗 Old Address: ${eventData.oldAddress.toBase58()}`);
        }
        console.log(`🔗 New Address: ${eventData.newAddress.toBase58()}`);
        break;

      default:
        console.log("📊 Raw Event Data:", JSON.stringify(eventData, null, 2));
    }

    console.log("=".repeat(80));
  }

  /**
   * Scan recent blocks for past events
   */
  async scanRecentBlocks() {
    const blockCount = hoursToBlocks(this.scanHours);
    console.log(`🔍 Scanning last ${this.scanHours} hour(s) (${blockCount} blocks) for events...`);

    try {
      const currentSlot = await this.connection.getSlot();
      console.log(`🎰 Current slot: ${currentSlot}`);

      for (let i = 0; i < blockCount; i++) {
        const slot = currentSlot - i;
        try {
          console.log(`📥 Fetching block ${i + 1}/${blockCount} (slot: ${slot})`);

          const block = await this.connection.getBlock(slot, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0
          });

          if (block && block.transactions) {
            console.log(`📋 Block ${slot} has ${block.transactions.length} transactions`);

            for (const tx of block.transactions) {
              if (tx.transaction && tx.meta && tx.meta.logMessages) {
                // Check if this transaction involves our program
                const hasOurProgram = tx.meta.logMessages.some(log =>
                  log.includes("4PonUp1nPEzDPnRMPjTqufLT3f37QuBJGk1CVnsTXx7x")
                );

                if (hasOurProgram) {
                  const signature = tx.transaction.signatures[0];
                  console.log(`🎯 Found transaction with our program: ${signature.substring(0, 16)}...`);
                  this.parseTransactionLogs(tx as any, signature);
                }
              }
            }
          }

          // Add delay to avoid rate limits
          if (i < blockCount - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } catch (error) {
          console.log(`⚠️  Error fetching block ${slot}:`, error);
        }
      }
    } catch (error) {
      console.error("❌ Error scanning recent blocks:", error);
    }
  }

  /**
   * Parse transaction logs for events
   */
  private parseTransactionLogs(tx: ParsedTransactionWithMeta, signature: string) {
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
    try {
      const events = this.eventParser.parseLogs(logs);

      for (const event of events) {
        console.log(`✅ Found event: ${event.name}`);
        this.displayEvent(event.name, event.data, signature, slot);
        eventFound = true;
      }
    } catch (error) {
      console.log(`⚠️  Error parsing events from logs: ${error}`);
    }

    // If no events found with Anchor parser, try manual Borsh parsing
    if (!eventFound) {
      for (const log of logs) {
        if (log.includes("Program data:")) {
          console.log(`📋 Found program data log: ${log.substring(0, 100)}...`);
          const manualEvent = this.tryBorshEventParsing(log, signature, slot);
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
  private tryBorshEventParsing(log: string, signature: string, slot: number): boolean {
    try {
      const base64Data = log.split("Program data: ")[1];
      if (!base64Data) return false;

      const eventData = Buffer.from(base64Data, 'base64');
      console.log(`🔍 Borsh parsing event data (${eventData.length} bytes): ${eventData.toString('hex').substring(0, 32)}...`);

      // Check for EscrowCreated discriminator
      if (eventData.length >= 8) {
        const discriminator = eventData.subarray(0, 8);
        const escrowCreatedDiscriminator = EVENT_DISCRIMINATORS.EscrowCreated;

        if (discriminator.equals(escrowCreatedDiscriminator)) {
          console.log(`✅ Found EscrowCreated event via Borsh parsing`);

          try {
            // Parse the event data using Borsh
            const parsedEvent = this.parseEscrowCreatedEvent(eventData);
            this.displayEvent("EscrowCreated", parsedEvent, signature, slot);
            return true;
          } catch (parseError) {
            console.log(`⚠️  Borsh parsing failed: ${parseError}`);
            // Fallback to simple display
            this.displaySimpleEvent("EscrowCreated", signature, slot, eventData.length, discriminator);
            return true;
          }
        }
      }
    } catch (error) {
      console.log(`⚠️  Borsh parsing failed: ${error}`);
    }
    return false;
  }

  /**
   * Parse EscrowCreated event using BorshCoder
   */
  private parseEscrowCreatedEvent(eventData: Buffer): any {
    try {
      // BorshCoder expects the full event data including discriminator
      const decoded = this.borshCoder.events.decode(eventData.toString('base64'));

      return decoded;
    } catch (error) {
      console.log(`⚠️  BorshCoder decoding failed: ${error}`);
      throw error;
    }
  }

  /**
   * Display a simple event when full parsing fails
   */
  private displaySimpleEvent(eventName: string, signature: string, slot: number, dataLength: number, discriminator: Buffer) {
    console.log("\n" + "=".repeat(80));
    console.log(`🎯 EVENT: ${eventName} (Simple Parse)`);
    console.log(`📝 Signature: ${signature}`);
    console.log(`🎰 Slot: ${slot}`);
    console.log(`⏰ Time: ${new Date().toISOString()}`);
    console.log("-".repeat(80));
    console.log(`🔍 Event detected but full parsing failed`);
    console.log(`📊 Raw data length: ${dataLength} bytes`);
    console.log(`🔐 Discriminator: ${discriminator.toString('hex')}`);
    console.log("=".repeat(80));
  }

  /**
   * Start listening for new events
   */
  async startListening() {
    if (this.isListening) {
      console.log("⚠️  Already listening for events");
      return;
    }

    console.log("🎧 Starting event listener...");
    this.isListening = true;

    try {
      this.subscriptionId = this.connection.onLogs(
        PROGRAM_ID,
        (logs, context) => {
          this.parseTransactionLogs(
            { slot: context.slot, meta: { logMessages: logs.logs } } as any,
            logs.signature
          );
        },
        "confirmed"
      );

      console.log("✅ Event listener started successfully");
      console.log(`📡 Listening for events from program: ${PROGRAM_ID.toBase58()}`);
      console.log("🔄 Waiting for new events... (Press Ctrl+C to stop)");
    } catch (error) {
      console.error("❌ Error starting event listener:", error);
      this.isListening = false;
    }
  }

  /**
   * Stop listening for events
   */
  async stopListening() {
    if (!this.isListening || this.subscriptionId === null) {
      console.log("⚠️  Not currently listening");
      return;
    }

    try {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
      this.isListening = false;
      console.log("🛑 Event listener stopped");
    } catch (error) {
      console.error("❌ Error stopping event listener:", error);
    }
  }

  /**
   * Get current slot for reference
   */
  async getCurrentSlot(): Promise<number> {
    return await this.connection.getSlot();
  }
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const scanHours = args.length > 0 ? parseFloat(args[0]) : 1;

  // Validate input
  if (isNaN(scanHours) || scanHours <= 0) {
    console.error("❌ Error: Hours must be a positive number");
    console.log("Usage: npm run event-listener [hours]");
    console.log("Example: npm run event-listener 24  # Scan last 24 hours");
    process.exit(1);
  }

  const blockCount = hoursToBlocks(scanHours);

  console.log("🚀 Solana Escrow Event Listener");
  console.log("=" .repeat(50));
  console.log(`🌐 RPC Endpoint: ${RPC_ENDPOINT}`);
  console.log(`📋 Program ID: ${PROGRAM_ID.toBase58()}`);
  console.log(`⏰ Scanning: ${scanHours} hour(s) (${blockCount} blocks)`);
  console.log("=" .repeat(50));

  const listener = new EventListener(scanHours);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log("\n🛑 Shutting down event listener...");
    await listener.stopListening();
    process.exit(0);
  });

  try {
    // Get current slot
    const currentSlot = await listener.getCurrentSlot();
    console.log(`🎰 Current Slot: ${currentSlot}`);

    // Scan for recent events first
    await listener.scanRecentBlocks();

    // Start listening for new events
    await listener.startListening();

    // Keep the process alive
    await new Promise(() => {}); // This will run indefinitely
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
}

export { EventListener };
