import * as dotenv from 'dotenv';
import { wsProvider, getContract } from '../celo';
import { query, recordTransaction } from '../db';
import type { LogDescription, ParamType } from 'ethers';
import fs from 'fs';
import path from 'path';

dotenv.config();

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
if (!CONTRACT_ADDRESS) {
  throw new Error('CONTRACT_ADDRESS not set in environment variables');
}

const logFilePath = path.join(process.cwd(), 'events.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function fileLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  logStream.write(line);
}

// Typed representation of chain log with necessary fields
interface ContractLog {
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  topics: string[];
  data: string;
}

export function startEventListener() {
  const contract = getContract(wsProvider);
  console.log('Starting contract event listener for', CONTRACT_ADDRESS);
  fileLog(`Starting contract event listener for ${CONTRACT_ADDRESS}`);
  // heartbeat: log every minute to show connection alive
  setInterval(() => fileLog('heartbeat'), 60_000);
  // catch underlying WebSocket close and error
  type WebSocketProvider = typeof wsProvider;
  type WebSocketConnection = {
    onclose: (event: { code: number }) => void;
    onerror: (error: { message?: string }) => void;
  };
  
  const rawWs = ((wsProvider as WebSocketProvider) as unknown as { 
    _websocket?: WebSocketConnection; 
    ws?: WebSocketConnection 
  })._websocket || ((wsProvider as WebSocketProvider) as unknown as { 
    _websocket?: WebSocketConnection; 
    ws?: WebSocketConnection 
  }).ws;
  
  if (rawWs) {
    rawWs.onclose = (event: { code: number }) => fileLog(`WebSocket closed: ${event.code}`);
    rawWs.onerror = (error: { message?: string }) => fileLog(`WebSocket error: ${error.message || error}`);
  }

  // Listen to all logs from this contract
  const filter = { address: CONTRACT_ADDRESS };

  wsProvider.on(filter, async (log: ContractLog) => {
    try {
      const parsed = contract.interface.parseLog(log) as LogDescription;
      if (!parsed) return;
      // Build args object
      const argsObj: Record<string, unknown> = {};
      parsed.fragment.inputs.forEach((input: ParamType, idx: number) => {
        const raw = parsed.args[idx];
        argsObj[input.name] = typeof raw === 'bigint' ? raw.toString() : raw;
      });
      const tradeIdValue = parsed.args.tradeId !== undefined
        ? Number(parsed.args.tradeId.toString())
        : null;

      const insertSql = `
        INSERT INTO contract_events
          (event_name, block_number, transaction_hash, log_index, args, trade_id, transaction_id)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        ON CONFLICT DO NOTHING;
      `;
      // Record the transaction and get its DB ID
      const transactionId = await recordTransaction({
        transaction_hash: log.transactionHash,
        status: 'SUCCESS',
        type: 'OTHER',
        block_number: log.blockNumber,
        related_trade_id: tradeIdValue,
      });
      const params = [
        parsed.name,
        log.blockNumber,
        log.transactionHash,
        log.logIndex,
        JSON.stringify(argsObj),
        tradeIdValue,
        transactionId,
      ];

      await query(insertSql, params);
      console.log(`Logged event ${parsed.name} tx=${log.transactionHash} logIndex=${log.logIndex} args=${JSON.stringify(argsObj)}`);
      fileLog(`Logged event ${parsed.name} tx=${log.transactionHash} logIndex=${log.logIndex} args=${JSON.stringify(argsObj)}`);

      // Sync normalized escrow & trade state
      switch (parsed.name) {
        case 'EscrowCreated': {
          const escrowId = parsed.args.escrowId.toString();
          const tradeId = Number(parsed.args.tradeId.toString());
          const seller = parsed.args.seller as string;
          const buyer = parsed.args.buyer as string;
          const arbitrator = parsed.args.arbitrator as string;
          const amount = parsed.args.amount.toString();
          const depositTs = Number(parsed.args.deposit_deadline.toString());
          const fiatTs = Number(parsed.args.fiat_deadline.toString());
          const depositDate = new Date(depositTs * 1000);
          const fiatDate = new Date(fiatTs * 1000);
          const sequential = parsed.args.sequential as boolean;
          const seqAddr = parsed.args.sequentialEscrowAddress as string;
          // Upsert escrow record, avoid overwriting frontend record
          const existing = await query(
            'SELECT id FROM escrows WHERE onchain_escrow_id = $1',
            [escrowId]
          );
          if (existing.length > 0) {
            await query(
              'UPDATE escrows SET state = $1, deposit_deadline = $2, fiat_deadline = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
              ['CREATED', depositDate, fiatDate, existing[0].id]
            );
            console.log(`EscrowCreated: Updated escrow id=${existing[0].id} deposit_deadline=${depositDate.toISOString()} fiat_deadline=${fiatDate.toISOString()}`);
            fileLog(`EscrowCreated: Updated escrow id=${existing[0].id} deposit_deadline=${depositDate.toISOString()} fiat_deadline=${fiatDate.toISOString()}`);
          } else {
            await query(
              'INSERT INTO escrows (trade_id, escrow_address, seller_address, buyer_address, arbitrator_address, token_type, amount, state, sequential, sequential_escrow_address, onchain_escrow_id, deposit_deadline, fiat_deadline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
              [tradeId, CONTRACT_ADDRESS, seller, buyer, arbitrator, 'USDC', amount, 'CREATED', sequential, seqAddr, escrowId, depositDate, fiatDate]
            );
            console.log(`EscrowCreated: Inserted escrow onchainId=${escrowId} for tradeId=${tradeId}`);
            fileLog(`EscrowCreated: Inserted escrow onchainId=${escrowId} for tradeId=${tradeId}`);
          }
          // Update trade leg state
          await query(
            'UPDATE trades SET leg1_state = $1, leg1_escrow_onchain_id = $2 WHERE id = $3 AND leg1_state <> $1',
            ['CREATED', escrowId, tradeId]
          );
          console.log(`EscrowCreated: Updated trade id=${tradeId} leg1_state=CREATED onchainEscrowId=${escrowId}`);
          fileLog(`EscrowCreated: Updated trade id=${tradeId} leg1_state=CREATED onchainEscrowId=${escrowId}`);
          break;
        }
        case 'EscrowFunded': {
          const escrowId = parsed.args.escrowId.toString();
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND state <> $1',
            ['FUNDED', escrowId]
          );
          console.log(`EscrowFunded: Updated escrow onchainId=${escrowId} state=FUNDED`);
          fileLog(`EscrowFunded: Updated escrow onchainId=${escrowId} state=FUNDED`);
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['FUNDED', escrowId]
          );
          console.log(`EscrowFunded: Updated trade leg1_state=FUNDED for escrowId=${escrowId}`);
          fileLog(`EscrowFunded: Updated trade leg1_state=FUNDED for escrowId=${escrowId}`);
          break;
        }
        case 'EscrowReleased': {
          const escrowId = parsed.args.escrowId.toString();
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND state <> $1',
            ['RELEASED', escrowId]
          );
          console.log(`EscrowReleased: Updated escrow onchainId=${escrowId} state=RELEASED`);
          fileLog(`EscrowReleased: Updated escrow onchainId=${escrowId} state=RELEASED`);
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['RELEASED', escrowId]
          );
          console.log(`EscrowReleased: Updated trade leg1_state=RELEASED for escrowId=${escrowId}`);
          fileLog(`EscrowReleased: Updated trade leg1_state=RELEASED for escrowId=${escrowId}`);
          break;
        }
        case 'EscrowCancelled': {
          const escrowId = parsed.args.escrowId.toString();
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND state <> $1',
            ['CANCELLED', escrowId]
          );
          console.log(`EscrowCancelled: Updated escrow onchainId=${escrowId} state=CANCELLED`);
          fileLog(`EscrowCancelled: Updated escrow onchainId=${escrowId} state=CANCELLED`);
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['CANCELLED', escrowId]
          );
          console.log(`EscrowCancelled: Updated trade leg1_state=CANCELLED for escrowId=${escrowId}`);
          fileLog(`EscrowCancelled: Updated trade leg1_state=CANCELLED for escrowId=${escrowId}`);
          break;
        }
        case 'FundsDeposited': {
          const escrowId = parsed.args.escrowId.toString();
          const timestamp = Number(parsed.args.timestamp.toString());
          const counter = Number(parsed.args.counter.toString());
          // mark fiat paid on escrow
          await query(
            'UPDATE escrows SET fiat_paid = TRUE, counter = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND (fiat_paid = FALSE OR counter <> $1)',
            [counter, escrowId]
          );
          console.log(`FundsDeposited: Updated escrow onchainId=${escrowId} fiat_paid counter=${counter}`);
          fileLog(`FundsDeposited: Updated escrow onchainId=${escrowId} fiat_paid counter=${counter}`);
          // update trade legs fiat paid
          await query(
            'UPDATE trades SET leg1_state = $1, leg1_fiat_paid_at = to_timestamp($2) WHERE leg1_escrow_onchain_id = $3 AND leg1_state <> $1',
            ['FIAT_PAID', timestamp, escrowId]
          );
          console.log(`FundsDeposited: Updated trade leg1_state=FIAT_PAID for escrowId=${escrowId}`);
          fileLog(`FundsDeposited: Updated trade leg1_state=FIAT_PAID for escrowId=${escrowId}`);
          await query(
            'UPDATE trades SET leg2_state = $1, leg2_fiat_paid_at = to_timestamp($2) WHERE leg2_escrow_onchain_id = $3 AND leg2_state <> $1',
            ['FIAT_PAID', timestamp, escrowId]
          );
          console.log(`FundsDeposited: Updated trade leg2_state=FIAT_PAID for escrowId=${escrowId}`);
          fileLog(`FundsDeposited: Updated trade leg2_state=FIAT_PAID for escrowId=${escrowId}`);
          break;
        }
        case 'DisputeOpened': {
          const escrowId = parsed.args.escrowId.toString();
          // mark escrow disputed
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND state <> $1',
            ['DISPUTED', escrowId]
          );
          console.log(`DisputeOpened: Updated escrow onchainId=${escrowId} state=DISPUTED`);
          fileLog(`DisputeOpened: Updated escrow onchainId=${escrowId} state=DISPUTED`);
          // update trade legs disputed
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['DISPUTED', escrowId]
          );
          console.log(`DisputeOpened: Updated trade leg1_state=DISPUTED for escrowId=${escrowId}`);
          fileLog(`DisputeOpened: Updated trade leg1_state=DISPUTED for escrowId=${escrowId}`);
          await query(
            'UPDATE trades SET leg2_state = $1 WHERE leg2_escrow_onchain_id = $2 AND leg2_state <> $1',
            ['DISPUTED', escrowId]
          );
          console.log(`DisputeOpened: Updated trade leg2_state=DISPUTED for escrowId=${escrowId}`);
          fileLog(`DisputeOpened: Updated trade leg2_state=DISPUTED for escrowId=${escrowId}`);
          break;
        }
        case 'DisputeResponse': {
          const escrowId = parsed.args.escrowId.toString();
          // mark escrow resolved
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND state <> $1',
            ['RESOLVED', escrowId]
          );
          console.log(`DisputeResponse: Updated escrow onchainId=${escrowId} state=RESOLVED`);
          fileLog(`DisputeResponse: Updated escrow onchainId=${escrowId} state=RESOLVED`);
          // update trade legs resolved
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['RESOLVED', escrowId]
          );
          console.log(`DisputeResponse: Updated trade leg1_state=RESOLVED for escrowId=${escrowId}`);
          fileLog(`DisputeResponse: Updated trade leg1_state=RESOLVED for escrowId=${escrowId}`);
          await query(
            'UPDATE trades SET leg2_state = $1 WHERE leg2_escrow_onchain_id = $2 AND leg2_state <> $1',
            ['RESOLVED', escrowId]
          );
          console.log(`DisputeResponse: Updated trade leg2_state=RESOLVED for escrowId=${escrowId}`);
          fileLog(`DisputeResponse: Updated trade leg2_state=RESOLVED for escrowId=${escrowId}`);
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error('Error handling log:', err);
      fileLog(`Error handling log: ${err}`);
    }
  });
}
