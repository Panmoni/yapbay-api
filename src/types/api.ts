export interface Escrow {
  id: number;
  trade_id: number;
  escrow_address: string;
  seller_address: string;
  buyer_address: string;
  arbitrator_address: string;
  token_type: string;
  amount: string;
  state: 'CREATED' | 'FUNDED' | 'RELEASED' | 'CANCELLED' | 'DISPUTED' | 'RESOLVED';
  sequential: boolean;
  sequential_escrow_address: string | null;
  onchain_escrow_id: string | null;

  // Network-specific fields
  network_family: 'evm' | 'solana';
  network_id: number;

  // Solana-specific fields
  program_id?: string;
  escrow_pda?: string;
  escrow_token_account?: string;
  escrow_onchain_id?: string;
  trade_onchain_id?: string;

  created_at: string;
  updated_at: string;
}

export interface TransactionRecord {
  id: number;
  trade_id: number;
  escrow_id?: number;
  transaction_hash?: string; // EVM
  signature?: string; // Solana
  transaction_type: string;
  from_address: string;
  to_address?: string;
  amount?: string;
  token_type?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  block_number?: number; // EVM
  slot?: number; // Solana
  error_message?: string;
  network_family: 'evm' | 'solana';
  network_id: number;
  created_at: string;
  metadata?: Record<string, string>;
}

export interface NetworkInfo {
  chainId?: number;
  version?: string;
  name?: string;
  blockHeight?: number;
  slot?: number;
}
