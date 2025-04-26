// npx ts-node scripts/test-events.ts
// npx ts-node --transpile-only scripts/test-events.ts
// npm run test-events -- --persist to grab history

import * as dotenv from 'dotenv';
import { provider, getContract } from '../src/celo';
import { query } from '../src/db';

dotenv.config();
// DB insert only when --persist flag is provided
const persist = process.argv.includes('--persist');

const main = async () => {
  const contract = getContract(provider);
  // const address = process.env.CONTRACT_ADDRESS!;
  const fromBlock = process.env.FROM_BLOCK ? Number(process.env.FROM_BLOCK) : 0;
  console.log(`Fetching events from block ${fromBlock} to latest...`);

  // fetch all events for this contract
  const logs = await provider.getLogs({
    address: process.env.CONTRACT_ADDRESS!,
    fromBlock,
    toBlock: 'latest',
  });
  console.log(`Found ${logs.length} logs`);
  const evts = logs.map(log => {
    const parsed = contract.interface.parseLog(log) as any;
    return {
      ...parsed,
      args: parsed.args,
      fragment: parsed.fragment,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      data: log.data,
      topics: log.topics,
    };
  });

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
        argsObj[input.name] = typeof rawVal === 'bigint' ? rawVal.toString() : rawVal;
      });
      const tradeIdValue = evt.args.tradeId !== undefined
        ? Number(evt.args.tradeId.toString())
        : null;
      const insertSql = `
        INSERT INTO contract_events
          (event_name, block_number, transaction_hash, log_index, args, trade_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING;
      `;
      await query(insertSql, [name, evt.blockNumber, evt.transactionHash, logIndex, argsObj, tradeIdValue]);
      console.log(`Inserted event ${name} tx=${evt.transactionHash} logIndex=${logIndex} trade=${tradeIdValue}`);
    }
  }
};

main().catch(err => {
  console.error('Error fetching events:', err);
  process.exit(1);
});
