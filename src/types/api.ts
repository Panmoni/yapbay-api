export interface Escrow {
  amount: string;
  arbitrator_address: string;
  buyer_address: string;

  created_at: string;
  escrow_address: string;
  escrow_onchain_id?: string;
  escrow_pda?: string;
  escrow_token_account?: string;
  id: number;

  // Network-specific fields
  network_family: 'evm' | 'solana';
  network_id: number;
  onchain_escrow_id: string | null;

  // Solana-specific fields
  program_id?: string;
  seller_address: string;
  sequential: boolean;
  sequential_escrow_address: string | null;
  state: 'CREATED' | 'FUNDED' | 'RELEASED' | 'CANCELLED' | 'DISPUTED' | 'RESOLVED';
  token_type: string;
  trade_id: number;
  trade_onchain_id?: string;
  updated_at: string;
}

export interface TransactionRecord {
  amount?: string;
  block_number?: number; // EVM
  created_at: string;
  error_message?: string;
  escrow_id?: number;
  from_address: string;
  id: number;
  metadata?: Record<string, string>;
  network_family: 'evm' | 'solana';
  network_id: number;
  signature?: string; // Solana
  slot?: number; // Solana
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  to_address?: string;
  token_type?: string;
  trade_id: number;
  transaction_hash?: string; // EVM
  transaction_type: string;
}

export interface NetworkInfo {
  blockHeight?: number;
  chainId?: number;
  name?: string;
  slot?: number;
  version?: string;
}
