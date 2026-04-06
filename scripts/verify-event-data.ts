#!/usr/bin/env ts-node

/**
 * Event Data Verification Script
 *
 * This script reads the raw event data from the database and decodes it
 * to verify it matches the expected EscrowCreated event structure.
 */

import { BorshCoder } from '@coral-xyz/anchor';
import * as dotenv from 'dotenv';
import { query } from '../src/db';

dotenv.config();

// Load the actual IDL
const idl = require('../src/contracts/solana/idl.json');

// Event discriminators
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

class EventDataVerifier {
  private readonly borshCoder: BorshCoder;

  constructor() {
    // Initialize BorshCoder with the actual IDL
    this.borshCoder = new BorshCoder(idl);
  }

  /**
   * Format USDC amounts for display
   */
  private formatUsdcAmount(amount: number): string {
    return `${(amount / 1_000_000).toFixed(6)} USDC`;
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toISOString();
  }

  /**
   * Verify event data from database
   */
  async verifyEventData(): Promise<void> {
    console.log('🔍 Fetching EscrowCreated event from database...');

    try {
      // Get the most recent EscrowCreated event
      const events = await query(`
        SELECT 
          ce.*,
          t.signature,
          t.slot,
          t.network_id
        FROM contract_events ce
        JOIN transactions t ON ce.transaction_hash = t.signature
        WHERE ce.event_name = 'EscrowCreated'
        ORDER BY ce.created_at DESC
        LIMIT 1
      `);

      if (events.length === 0) {
        console.log('❌ No EscrowCreated events found in database');
        return;
      }

      const event = events[0];
      console.log('✅ Found EscrowCreated event in database:');
      console.log(`📝 Signature: ${event.signature}`);
      console.log(`🎰 Slot: ${event.slot}`);
      console.log(`🌐 Network ID: ${event.network_id}`);
      console.log(`⏰ Created: ${event.created_at}`);

      // Extract raw data from args
      const rawData = event.args.raw.data;
      console.log(`📊 Raw data length: ${rawData.length} bytes`);

      // Convert array to Buffer
      const eventBuffer = Buffer.from(rawData);
      console.log(`🔍 Raw data (hex): ${eventBuffer.toString('hex').substring(0, 64)}...`);

      // Check discriminator
      if (eventBuffer.length >= 8) {
        const discriminator = eventBuffer.subarray(0, 8);
        const escrowCreatedDiscriminator = EVENT_DISCRIMINATORS.EscrowCreated;

        console.log(`🔐 Discriminator: ${discriminator.toString('hex')}`);
        console.log(`🎯 Expected: ${escrowCreatedDiscriminator.toString('hex')}`);

        if (discriminator.equals(escrowCreatedDiscriminator)) {
          console.log('✅ Discriminator matches EscrowCreated!');
        } else {
          console.log('❌ Discriminator does not match EscrowCreated');
          return;
        }
      }

      // Decode the event data using BorshCoder
      console.log('\n🔍 Decoding event data...');
      try {
        const eventData = this.parseEscrowCreatedEvent(eventBuffer);
        this.displayDecodedEvent(eventData);
      } catch (error) {
        console.log(`⚠️  BorshCoder parsing failed: ${error}`);
        this.debugEventBuffer(eventBuffer);
      }
    } catch (error) {
      console.error('❌ Error verifying event data:', error);
    }
  }

  /**
   * Display decoded event data
   */
  private displayDecodedEvent(eventData: any): void {
    console.log(`\n${'='.repeat(80)}`);
    console.log('🎯 DECODED EscrowCreated EVENT');
    console.log('='.repeat(80));

    // Handle different event data structures
    const data = eventData.data || eventData;

    console.log(`🆔 Escrow ID: ${data.escrow_id?.toString() || 'N/A'}`);
    console.log(`🔄 Trade ID: ${data.trade_id?.toString() || 'N/A'}`);
    console.log(`👤 Seller: ${data.seller?.toBase58() || data.seller || 'N/A'}`);
    console.log(`👤 Buyer: ${data.buyer?.toBase58() || data.buyer || 'N/A'}`);
    console.log(`⚖️  Arbitrator: ${data.arbitrator?.toBase58() || data.arbitrator || 'N/A'}`);
    console.log(
      `💰 Amount: ${
        data.amount
          ? this.formatUsdcAmount(data.amount.toNumber ? data.amount.toNumber() : data.amount)
          : 'N/A'
      }`,
    );
    console.log(
      `💸 Fee: ${
        data.fee ? this.formatUsdcAmount(data.fee.toNumber ? data.fee.toNumber() : data.fee) : 'N/A'
      }`,
    );
    console.log(
      `⏳ Deposit Deadline: ${
        data.deposit_deadline
          ? this.formatTimestamp(
              data.deposit_deadline.toNumber
                ? data.deposit_deadline.toNumber()
                : data.deposit_deadline,
            )
          : 'N/A'
      }`,
    );
    console.log(
      `🔄 Sequential: ${data.sequential === undefined ? 'N/A' : data.sequential ? 'Yes' : 'No'}`,
    );
    console.log(
      `🔗 Sequential Address: ${
        data.sequential_escrow_address?.toBase58() || data.sequential_escrow_address || 'N/A'
      }`,
    );
    console.log(
      `⏰ Timestamp: ${
        data.timestamp
          ? this.formatTimestamp(
              data.timestamp.toNumber ? data.timestamp.toNumber() : data.timestamp,
            )
          : 'N/A'
      }`,
    );

    console.log('='.repeat(80));
  }

  /**
   * Parse EscrowCreated event data using BorshCoder with actual IDL
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
   * Fallback debugging method for when BorshCoder fails
   */
  private debugEventBuffer(eventBuffer: Buffer): void {
    console.log('\n🔍 DEBUGGING EVENT BUFFER:');
    console.log(`📊 Buffer length: ${eventBuffer.length} bytes`);
    console.log(`🔐 Discriminator: ${eventBuffer.subarray(0, 8).toString('hex')}`);
    console.log(`📋 Raw data (hex): ${eventBuffer.toString('hex').substring(0, 64)}...`);
  }
}

async function main() {
  console.log('🚀 Event Data Verification Script');
  console.log('='.repeat(50));
  console.log('📋 Reading from database and decoding event data...');
  console.log('='.repeat(50));

  const verifier = new EventDataVerifier();

  try {
    await verifier.verifyEventData();
    console.log('\n✅ Event data display completed!');
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

export { EventDataVerifier };
