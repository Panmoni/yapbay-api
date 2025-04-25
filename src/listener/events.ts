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
    } catch (err) {
      console.error('Error handling log:', err);
    }
  });
}
