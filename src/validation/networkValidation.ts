import { PublicKey } from '@solana/web3.js';
import { ethers } from 'ethers';

export class NetworkValidator {
  static validateAddress(address: string, networkFamily: 'evm' | 'solana'): boolean {
    if (networkFamily === 'evm') {
      return ethers.isAddress(address);
    } else if (networkFamily === 'solana') {
      try {
        new PublicKey(address);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  static validateTransactionHash(hash: string, networkFamily: 'evm' | 'solana'): boolean {
    if (networkFamily === 'evm') {
      return ethers.isHexString(hash) && hash.length === 66;
    } else if (networkFamily === 'solana') {
      // Solana signatures are base58 encoded, typically 88 characters
      return /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(hash);
    }
    return false;
  }

  static validateEscrowId(escrowId: string, networkFamily: 'evm' | 'solana'): boolean {
    if (networkFamily === 'evm') {
      return ethers.isHexString(escrowId);
    } else if (networkFamily === 'solana') {
      // Solana escrow IDs are u64 as string
      return /^\d+$/.test(escrowId) && parseInt(escrowId) >= 0;
    }
    return false;
  }

  static validatePDA(pda: string): boolean {
    try {
      new PublicKey(pda);
      return true;
    } catch {
      return false;
    }
  }

  static validateProgramId(programId: string): boolean {
    try {
      new PublicKey(programId);
      return true;
    } catch {
      return false;
    }
  }
}
