import * as dotenv from 'dotenv';
import { provider, getContract } from '../celo';
import { query } from '../db';
import type { LogDescription, ParamType } from 'ethers';

dotenv.config();

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
if (!CONTRACT_ADDRESS) {
  throw new Error('CONTRACT_ADDRESS not set in environment variables');
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
  const contract = getContract(provider);
  console.log('Starting contract event listener for', CONTRACT_ADDRESS);

  // Listen to all logs from this contract
  const filter = { address: CONTRACT_ADDRESS };

  provider.on(filter, async (log: ContractLog) => {
    try {
      const parsed = contract.interface.parseLog(log) as LogDescription;
      if (!parsed) return;
      // Build args object
      const argsObj: Record<string, unknown> = {};
      parsed.fragment.inputs.forEach((input: ParamType, idx: number) => {
        argsObj[input.name] = parsed.args[idx];
      });

      const insertSql = `
        INSERT INTO contract_events
          (event_name, block_number, transaction_hash, log_index, args)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING;
      `;
      const params = [
        parsed.name,
        log.blockNumber,
        log.transactionHash,
        log.logIndex,
        argsObj
      ];

      await query(insertSql, params);
      console.log(`Logged event ${parsed.name} tx=${log.transactionHash} logIndex=${log.logIndex}`);

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
          } else {
            await query(
              'INSERT INTO escrows (trade_id, escrow_address, seller_address, buyer_address, arbitrator_address, token_type, amount, state, sequential, sequential_escrow_address, onchain_escrow_id, deposit_deadline, fiat_deadline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
              [tradeId, CONTRACT_ADDRESS, seller, buyer, arbitrator, 'USDC', amount, 'CREATED', sequential, seqAddr, escrowId, depositDate, fiatDate]
            );
          }
          // Update trade leg state
          await query(
            'UPDATE trades SET leg1_state = $1, leg1_escrow_onchain_id = $2 WHERE id = $3 AND leg1_state <> $1',
            ['CREATED', escrowId, tradeId]
          );
          break;
        }
        case 'EscrowFunded': {
          const escrowId = parsed.args.escrowId.toString();
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND state <> $1',
            ['FUNDED', escrowId]
          );
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['FUNDED', escrowId]
          );
          break;
        }
        case 'EscrowReleased': {
          const escrowId = parsed.args.escrowId.toString();
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND state <> $1',
            ['RELEASED', escrowId]
          );
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['RELEASED', escrowId]
          );
          break;
        }
        case 'EscrowCancelled': {
          const escrowId = parsed.args.escrowId.toString();
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE onchain_escrow_id = $2 AND state <> $1',
            ['CANCELLED', escrowId]
          );
          await query(
            'UPDATE trades SET leg1_state = $1 WHERE leg1_escrow_onchain_id = $2 AND leg1_state <> $1',
            ['CANCELLED', escrowId]
          );
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error('Error handling log:', err);
    }
  });
}
