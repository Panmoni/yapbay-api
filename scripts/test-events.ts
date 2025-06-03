// npx ts-node scripts/test-events.ts
// npx ts-node --transpile-only scripts/test-events.ts
// npm run test-events -- --persist to grab history

import * as dotenv from 'dotenv';
import { CeloService } from '../src/celo';
import { query, recordTransaction } from '../src/db';
import { NetworkService } from '../src/services/networkService';

dotenv.config();
// DB insert only when --persist flag is provided
const persist = process.argv.includes('--persist');

const main = async () => {
  // Get default network and provider
  const defaultNetwork = await NetworkService.getDefaultNetwork();
  const provider = await CeloService.getProviderForNetwork(defaultNetwork.id);
  const contract = await CeloService.getContractForNetwork(defaultNetwork.id, provider);
  
  // Determine network and appropriate FROM_BLOCK
  const isMainnet = defaultNetwork.id === 42220; // Celo Mainnet chainId
  const fromBlock = isMainnet 
    ? (process.env.FROM_BLOCK_MAINNET ? Number(process.env.FROM_BLOCK_MAINNET) : 0)
    : (process.env.FROM_BLOCK_TESTNET ? Number(process.env.FROM_BLOCK_TESTNET) : 0);
    
  console.log(`Network: ${defaultNetwork.name} (ChainId: ${defaultNetwork.id})`);
  console.log(`Fetching events from block ${fromBlock} to latest...`);

  // fetch all events for this contract
  const logs = await provider.getLogs({
    address: defaultNetwork.contractAddress,
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
      const transactionId = await recordTransaction({
        transaction_hash: evt.transactionHash,
        status: 'SUCCESS',
        type: 'OTHER',
        block_number: evt.blockNumber,
        related_trade_id: tradeIdValue,
        network_id: defaultNetwork.id
      });
      const insertSql = `
        INSERT INTO contract_events
          (event_name, block_number, transaction_hash, log_index, args, trade_id, transaction_id, network_id)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
        ON CONFLICT DO NOTHING;
      `;
      await query(insertSql, [
        name,
        evt.blockNumber,
        evt.transactionHash,
        logIndex,
        JSON.stringify(argsObj),
        tradeIdValue,
        transactionId,
        defaultNetwork.id
      ]);
      console.log(`Inserted event ${name} tx=${evt.transactionHash} logIndex=${logIndex} trade=${tradeIdValue}`);
    }
  }
};

main().catch(err => {
  console.error('Error fetching events:', err);
  process.exit(1);
});
