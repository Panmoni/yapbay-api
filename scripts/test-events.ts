// npx ts-node scripts/test-events.ts
// npx ts-node --transpile-only scripts/test-events.ts

import * as dotenv from 'dotenv';
import { provider, getContract } from '../src/celo';
import { query } from '../src/db';

dotenv.config();
// DB insert only when --persist flag is provided
const persist = process.argv.includes('--persist');

const main = async () => {
  const contract = getContract(provider);
  const address = process.env.CONTRACT_ADDRESS!;
  const fromBlock = process.env.FROM_BLOCK ? Number(process.env.FROM_BLOCK) : 0;
  console.log(`Fetching events from block ${fromBlock} to latest...`);

  // for example, only fetch escrow-related events:
  const filter = contract.filters.EscrowCreated();
  const evts = (await contract.queryFilter(filter, fromBlock, 'latest')) as any[];
  console.log(`Found ${evts.length} events`);
  for (const evt of evts) {
    const receipt: any = await provider.getTransactionReceipt(evt.transactionHash);
    if (!receipt) {
      console.warn(`No receipt found for tx ${evt.transactionHash}`);
      continue;
    }

    const rawLog: any = receipt.logs.find(
      (l: any) => l.data === evt.data && JSON.stringify(l.topics) === JSON.stringify(evt.topics)
    );

    const name = (evt as any).event ?? (evt as any).fragment?.name;
    const logIndex = rawLog?.index;

    console.log({
      name,
      args: evt.args,
      block: evt.blockNumber,
      txHash: evt.transactionHash,
      logIndex,
    });

    if (persist) {
      const argsObj: Record<string, unknown> = {};
      evt.fragment.inputs.forEach((input: any, idx: number) => {
        const rawVal = evt.args[idx];
        // convert BigInt to string for JSONB
        argsObj[input.name] = typeof rawVal === 'bigint' ? rawVal.toString() : rawVal;
      });
      const insertSql = `
        INSERT INTO contract_events
          (event_name, block_number, transaction_hash, log_index, args)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING;
      `;
      await query(insertSql, [name, evt.blockNumber, evt.transactionHash, logIndex, argsObj]);
      console.log(`Inserted event ${name} tx=${evt.transactionHash} logIndex=${logIndex}`);
    }
  }
};

main().catch(err => {
  console.error('Error fetching events:', err);
  process.exit(1);
});
