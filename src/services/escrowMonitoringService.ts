import { ethers } from 'ethers';
import { CeloService } from '../celo';
import { NetworkService } from './networkService';
import { YapBayEscrow } from '../types/YapBayEscrow';

import pool, { syncEscrowBalance, recordBalanceValidation } from '../db';
import * as dotenv from 'dotenv';

dotenv.config();

// Network detection
const USE_TESTNET = process.env.NODE_ENV === 'development' || process.env.USE_TESTNET === 'true';
const NETWORK_NAME = USE_TESTNET ? 'Alfajores Testnet' : 'Celo Mainnet';

interface EscrowDetails {
  escrowId: number;
  tradeId: string;
  seller: string;
  amount: string;
  state: number;
  depositDeadline: number;
  fiatDeadline: number;
  fiatPaid: boolean;
}

interface AutoCancellationResult {
  escrowId: number;
  success: boolean;
  transactionHash?: string;
  gasUsed?: number;
  gasPrice?: string;
  errorMessage?: string;
}

/**
 * Service to monitor blockchain escrows and automatically cancel expired ones
 */
export class EscrowMonitoringService {
  private contract!: YapBayEscrow;
  private arbitratorWallet!: ethers.Wallet;

  constructor() {
    // This constructor is deprecated - use createForNetwork instead
    console.warn('⚠️  WARNING: Using deprecated constructor. Use EscrowMonitoringService.createForNetwork() instead.');
  }

  static async createForNetwork(networkId: number): Promise<EscrowMonitoringService> {
    const arbitratorPrivateKey = process.env.PRIVATE_KEY;
    if (!arbitratorPrivateKey) {
      throw new Error('PRIVATE_KEY not set in environment variables');
    }
    
    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      throw new Error(`Network with ID ${networkId} not found`);
    }
    
    const provider = await CeloService.getProviderForNetwork(networkId);
    const service = new EscrowMonitoringService();
    
    service.arbitratorWallet = new ethers.Wallet(arbitratorPrivateKey, provider);
    service.contract = await CeloService.getContractForNetwork(networkId, service.arbitratorWallet);
    
    return service;
  }

  /**
   * Main monitoring function to check for and cancel expired escrows
   */
  async monitorAndCancelExpiredEscrows(): Promise<void> {
    console.log(`[EscrowMonitor] Starting expired escrow check on ${NETWORK_NAME}: ${new Date().toISOString()}`);
    
    try {
      // Get all active escrows from database
      const activeEscrows = await this.getActiveEscrowsFromDatabase();
      
      if (activeEscrows.length === 0) {
        console.log('[EscrowMonitor] No active escrows found');
        return;
      }

      console.log(`[EscrowMonitor] Checking ${activeEscrows.length} active escrows`);

      // Check eligibility and cancel in batches
      const batchSize = parseInt(process.env.ESCROW_MONITOR_BATCH_SIZE || '50');
      const delayHours = parseInt(process.env.AUTO_CANCEL_DELAY_HOURS || '1');
      
      for (let i = 0; i < activeEscrows.length; i += batchSize) {
        const batch = activeEscrows.slice(i, i + batchSize);
        await this.processBatch(batch, delayHours);
      }

    } catch (error) {
      console.error(`[ERROR] Failed to start escrow monitoring:`, error);
      throw error;
    }
  }

  /**
   * Process a batch of escrows for auto-cancellation
   */
  private async processBatch(escrowIds: number[], delayHours: number): Promise<void> {
    const eligibilityPromises = escrowIds.map(id => this.checkEligibilityWithDelay(id, delayHours));
    const eligibilityResults = await Promise.allSettled(eligibilityPromises);

    const eligibleEscrows: number[] = [];
    
    eligibilityResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        eligibleEscrows.push(escrowIds[index]);
      } else if (result.status === 'rejected') {
        console.error(`[EscrowMonitor] Failed to check eligibility for escrow ${escrowIds[index]}:`, result.reason);
      }
    });

    if (eligibleEscrows.length > 0) {
      console.log(`[EscrowMonitor] Found ${eligibleEscrows.length} eligible escrows for auto-cancellation`);
      await this.performAutoCancellations(eligibleEscrows);
    }
  }

  /**
   * Check if an escrow is eligible for auto-cancellation with additional delay buffer
   */
  private async checkEligibilityWithDelay(escrowId: number, delayHours: number): Promise<boolean> {
    try {
      // First check basic contract eligibility
      const isEligible = await this.contract.isEligibleForAutoCancel(escrowId);
      
      if (!isEligible) {
        return false;
      }

      // Additional check: ensure enough time has passed since expiry (delay buffer)
      const escrowDetails = await this.getEscrowDetailsFromContract(escrowId);
      const now = Math.floor(Date.now() / 1000);
      const delaySeconds = delayHours * 3600;

      // Check if deposit deadline expired + delay
      if (escrowDetails.state === 0 && escrowDetails.depositDeadline > 0) { // CREATED state
        const expiredFor = now - escrowDetails.depositDeadline;
        return expiredFor >= delaySeconds;
      }

      // Check if fiat payment deadline expired + delay  
      if (escrowDetails.state === 1 && escrowDetails.fiatDeadline > 0 && !escrowDetails.fiatPaid) { // FUNDED state
        const expiredFor = now - escrowDetails.fiatDeadline;
        return expiredFor >= delaySeconds;
      }

      return false;
    } catch (error) {
      console.error(`[EscrowMonitor] Error checking eligibility for escrow ${escrowId}:`, error);
      return false;
    }
  }

  /**
   * Get escrow details from the smart contract
   */
  private async getEscrowDetailsFromContract(escrowId: number): Promise<EscrowDetails> {
    try {
      // Get escrow details using the escrows mapping
      const escrowInfo = await this.contract.escrows(escrowId);
      
      return {
        escrowId,
        tradeId: (escrowInfo.trade_id || escrowInfo[0] || '').toString(),
        seller: (escrowInfo.seller || escrowInfo[1] || '').toString(),
        amount: (escrowInfo.amount || escrowInfo[2] || 0).toString(),
        state: Number(escrowInfo.state || escrowInfo[3] || 0),
        depositDeadline: Number(escrowInfo.deposit_deadline || escrowInfo[4] || 0),
        fiatDeadline: Number(escrowInfo.fiat_deadline || escrowInfo[5] || 0),
        fiatPaid: Boolean(escrowInfo.fiat_paid || escrowInfo[6] || false)
      };
    } catch (error) {
      console.error(`[EscrowMonitor] Error getting escrow details for ${escrowId}:`, error);
      throw error;
    }
  }

  /**
   * Perform auto-cancellations for eligible escrows
   */
  private async performAutoCancellations(escrowIds: number[]): Promise<void> {
    const results: AutoCancellationResult[] = [];

    for (const escrowId of escrowIds) {
      try {
        console.log(`[EscrowMonitor] Attempting to auto-cancel escrow ${escrowId}`);
        
        // Validate balance before cancellation
        try {
          const storedBalance = await this.contract.getStoredEscrowBalance(escrowId);
          const calculatedBalance = await this.contract.getCalculatedEscrowBalance(escrowId);
          
          const storedFormatted = ethers.formatUnits(storedBalance, 6);
          const calculatedFormatted = ethers.formatUnits(calculatedBalance, 6);
          
          console.log(`[EscrowMonitor] Escrow ${escrowId} balance validation - Stored: ${storedFormatted} USDC, Calculated: ${calculatedFormatted} USDC`);
          
          // Get database balance for comparison
          const dbResult = await pool.query(
            'SELECT current_balance FROM escrows WHERE onchain_escrow_id = $1',
            [escrowId.toString()]
          );
          
          if (dbResult.rows.length > 0) {
            const dbBalance = dbResult.rows[0].current_balance;
            
            // Record balance validation for audit
            await recordBalanceValidation(
              escrowId.toString(),
              storedFormatted,
              calculatedFormatted,
              dbBalance
            );
            
            // Sync database if needed
            if (Math.abs(parseFloat(storedFormatted) - dbBalance) > 0.000001) {
              console.warn(`[EscrowMonitor] Database balance mismatch for escrow ${escrowId}: DB=${dbBalance}, Contract=${storedFormatted}`);
              await syncEscrowBalance(escrowId.toString(), storedFormatted, 'Auto-cancel validation sync');
            }
          }
          
          // Log warning if contract balances don't match expectations
          if (storedBalance !== calculatedBalance) {
            console.warn(`[EscrowMonitor] Contract balance mismatch for escrow ${escrowId}: stored=${storedFormatted}, calculated=${calculatedFormatted}`);
          }
        } catch (balanceError) {
          console.warn(`[EscrowMonitor] Could not validate balance for escrow ${escrowId}:`, balanceError);
        }
        
        // Estimate gas first to avoid failed transactions
        const gasEstimate = await this.contract.autoCancel.estimateGas(escrowId);
        const gasLimit = gasEstimate * 120n / 100n; // Add 20% buffer

        // Execute the auto-cancellation
        const tx = await this.contract.autoCancel(escrowId, {
          gasLimit: gasLimit
        });

        console.log(`[EscrowMonitor] Auto-cancel transaction submitted for escrow ${escrowId}: ${tx.hash}`);
        
        // Wait for confirmation
        const receipt = await tx.wait();
        
        const result: AutoCancellationResult = {
          escrowId,
          success: true,
          transactionHash: receipt?.hash || tx.hash,
          gasUsed: receipt?.gasUsed ? Number(receipt.gasUsed) : undefined,
          gasPrice: receipt?.gasPrice ? receipt.gasPrice.toString() : undefined
        };

        results.push(result);
        console.log(`[EscrowMonitor] Successfully auto-cancelled escrow ${escrowId}`);

      } catch (error: unknown) {
        console.error(`[EscrowMonitor] Failed to auto-cancel escrow ${escrowId}:`, error);
        
        const result: AutoCancellationResult = {
          escrowId,
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error)
        };

        results.push(result);
      }
    }

    // Record all results in database
    await this.recordAutoCancellationResults(results);
  }

  /**
   * Get list of active escrow IDs from database
   */
  private async getActiveEscrowsFromDatabase(): Promise<number[]> {
    const client = await pool.connect();
    try {
      // Get escrows that are in CREATED or FUNDED states and not yet cancelled/resolved
      const { rows } = await client.query(`
        SELECT DISTINCT 
          COALESCE(leg1_escrow_onchain_id, '0') as leg1_id,
          COALESCE(leg2_escrow_onchain_id, '0') as leg2_id,
          leg1_state,
          leg2_state
        FROM trades 
        WHERE overall_status = 'IN_PROGRESS'
          AND (
            (leg1_escrow_onchain_id IS NOT NULL AND leg1_state IN ('CREATED', 'FUNDED')) OR
            (leg2_escrow_onchain_id IS NOT NULL AND leg2_state IN ('CREATED', 'FUNDED'))
          )
      `);

      const escrowIds: number[] = [];
      
      rows.forEach(row => {
        if (row.leg1_id && row.leg1_id !== '0' && ['CREATED', 'FUNDED'].includes(row.leg1_state)) {
          escrowIds.push(parseInt(row.leg1_id));
        }
        if (row.leg2_id && row.leg2_id !== '0' && ['CREATED', 'FUNDED'].includes(row.leg2_state)) {
          escrowIds.push(parseInt(row.leg2_id));
        }
      });

      return [...new Set(escrowIds)]; // Remove duplicates
    } finally {
      client.release();
    }
  }

  /**
   * Record auto-cancellation results in database
   */
  private async recordAutoCancellationResults(results: AutoCancellationResult[]): Promise<void> {
    if (results.length === 0) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const result of results) {
        await client.query(`
          INSERT INTO contract_auto_cancellations 
          (escrow_id, transaction_hash, gas_used, gas_price, status, error_message)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          result.escrowId,
          result.transactionHash || null,
          result.gasUsed || null,
          result.gasPrice || null,
          result.success ? 'SUCCESS' : 'FAILED',
          result.errorMessage || null
        ]);

        console.log(`[EscrowMonitor] Recorded auto-cancellation result for escrow ${result.escrowId}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[EscrowMonitor] Error recording auto-cancellation results:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Validate balance consistency across database and contract
   */
  async validateAllEscrowBalances(): Promise<void> {
    console.log('[EscrowMonitor] Starting balance validation check');
    
    try {
      const activeEscrows = await this.getActiveEscrowsFromDatabase();
      
      for (const escrowId of activeEscrows) {
        try {
          const [storedBalance, calculatedBalance] = await Promise.all([
            this.contract.getStoredEscrowBalance(escrowId),
            this.contract.getCalculatedEscrowBalance(escrowId)
          ]);
          
          const storedFormatted = ethers.formatUnits(storedBalance, 6);
          const calculatedFormatted = ethers.formatUnits(calculatedBalance, 6);
          
          // Get database balance
          const dbResult = await pool.query(
            'SELECT current_balance FROM escrows WHERE onchain_escrow_id = $1',
            [escrowId.toString()]
          );
          
          if (dbResult.rows.length > 0) {
            const dbBalance = dbResult.rows[0].current_balance;
            
            // Check for significant differences (more than 1 micro-USDC)
            if (Math.abs(parseFloat(storedFormatted) - dbBalance) > 0.000001) {
              console.warn(`[EscrowMonitor] Balance sync needed for escrow ${escrowId}: DB=${dbBalance}, Contract=${storedFormatted}, Calculated=${calculatedFormatted}`);
              await syncEscrowBalance(escrowId.toString(), storedFormatted, 'Validation sync');
            }
          }
        } catch (error) {
          console.error(`[EscrowMonitor] Error validating balance for escrow ${escrowId}:`, error);
        }
      }
    } catch (error) {
      console.error('[EscrowMonitor] Error during balance validation:', error);
    }
  }
}

/**
 * Main function to run escrow monitoring (called by cron job)
 */
export async function monitorExpiredEscrows(): Promise<void> {
  // Check if monitoring is enabled
  const isEnabled = process.env.ESCROW_MONITOR_ENABLED === 'true';
  if (!isEnabled) {
    console.log('[EscrowMonitor] Monitoring disabled via ESCROW_MONITOR_ENABLED');
    return;
  }

  try {
    const service = new EscrowMonitoringService();
    await service.monitorAndCancelExpiredEscrows();
    
    // Run balance validation every 10th monitoring cycle (approximately every 10 minutes if running every minute)
    const shouldValidateBalances = Math.random() < 0.1; // 10% chance each run
    if (shouldValidateBalances) {
      await service.validateAllEscrowBalances();
    }
  } catch (error) {
    console.error('[EscrowMonitor] Critical error in monitoring service:', error);
    // Don't re-throw to prevent cron job from stopping
  }
}