// OnchainBalanceFetcher adapter for Solana networks.
//
// Returns the token balance of a given escrow account as a decimal string.
// If the account isn't a Solana escrow (wrong network family, bad PDA),
// returns null so the reconciliation job skips it instead of treating it
// as a zero balance.
//
// The fetcher is called from a cron loop, so it must:
// - never throw on transient RPC errors (reconcile logs + skips)
// - be deterministic-ish: same input → same output for the current slot
// - obey the circuit breaker so a degraded RPC doesn't pin the job

import { PublicKey } from '@solana/web3.js';
import { logger } from '../logger';
import { NetworkService } from '../services/networkService';
import { SolanaService } from '../services/solanaService';
import { getBreaker } from '../utils/circuitBreaker';

export async function fetchSolanaEscrowBalance(
  networkId: number,
  onchainEscrowId: string,
): Promise<string | null> {
  const network = await NetworkService.getNetworkById(networkId);
  if (!network || network.networkFamily !== 'solana') {
    return null;
  }

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(onchainEscrowId);
  } catch (err) {
    logger.warn(
      { err, onchain_escrow_id: onchainEscrowId },
      'fetchSolanaEscrowBalance: invalid pubkey',
    );
    return null;
  }

  const connection = await SolanaService.getConnectionForNetwork(networkId);
  const breaker = getBreaker(`solana-rpc:${network.name}`);

  try {
    const info = await breaker.fire(() => connection.getTokenAccountBalance(pubkey));
    // `uiAmountString` is the decimal representation from the RPC; prefer
    // it over `amount` (raw lamports) + mint-decimals math to avoid
    // off-by-one on decimals mismatch.
    const s = info?.value?.uiAmountString;
    if (typeof s !== 'string') {
      return null;
    }
    return s;
  } catch (err) {
    // Non-escrow accounts return "not found" from getTokenAccountBalance;
    // treat as skippable rather than propagating.
    logger.warn(
      { err, network: network.name, onchain_escrow_id: onchainEscrowId },
      'fetchSolanaEscrowBalance: RPC call failed',
    );
    return null;
  }
}
