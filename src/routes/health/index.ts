import express, { Response } from 'express';
import { query } from '../../db';
import { CeloService } from '../../celo';
import { NetworkService } from '../../services/networkService';
import { BlockchainServiceFactory } from '../../services/blockchainService';
import { optionalNetwork } from '../../middleware/networkMiddleware';
import { withErrorHandling } from '../../middleware/errorHandler';
import { logError } from '../../logger';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { getVersionInfo } from '../../utils/versionUtils';
import { AuthenticatedRequest } from '../../middleware/auth';
import { NetworkConfig, NetworkFamily } from '../../types/networks';
import { Connection } from '@solana/web3.js';

const router = express.Router();

// Health Check Endpoint (Authenticated)
router.get(
  '/',
  optionalNetwork,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const walletAddress = getWalletAddressFromJWT(req);
    let dbOk = false;
    interface NetworkStatus extends NetworkConfig {
      status: string;
      error: string | null;
      providerChainId?: number;
      providerName?: string;
      warning?: string;
      blockExplorerUrl?: string;
    }
    const networksStatus: NetworkStatus[] = [];

    // Check database connectivity and get counts
    let dbCounts = {
      accounts: 0,
      escrows: 0,
      offers: 0,
      trades: 0,
      transactions: 0,
    };

    try {
      await query('SELECT 1');
      dbOk = true;

      // Get database counts
      try {
        const [accountsResult, escrowsResult, offersResult, tradesResult, transactionsResult] =
          await Promise.all([
            query('SELECT COUNT(*) as count FROM accounts'),
            query('SELECT COUNT(*) as count FROM escrows'),
            query('SELECT COUNT(*) as count FROM offers'),
            query('SELECT COUNT(*) as count FROM trades'),
            query('SELECT COUNT(*) as count FROM transactions'),
          ]);

        dbCounts = {
          accounts: parseInt(accountsResult[0].count),
          escrows: parseInt(escrowsResult[0].count),
          offers: parseInt(offersResult[0].count),
          trades: parseInt(tradesResult[0].count),
          transactions: parseInt(transactionsResult[0].count),
        };
      } catch (countErr) {
        logError('Health check DB count queries failed', countErr as Error);
      }
    } catch (dbErr) {
      logError('Health check DB query failed', dbErr as Error);
    }

    // Get active networks and check their status
    try {
      const allNetworks = await NetworkService.getAllNetworks();
      const activeNetworks = allNetworks.filter(network => network.isActive);

      for (const network of activeNetworks) {
        const networkStatus: NetworkStatus = {
          ...network,
          status: 'Unknown',
          error: null,
        };

        try {
          const blockchainService = BlockchainServiceFactory.create(network);

          if (network.networkFamily === NetworkFamily.EVM) {
            // EVM network health check
            const provider = await CeloService.getProviderForNetwork(network.id);
            const celoNetwork = await provider.getNetwork();
            networkStatus.status = 'Connected';
            networkStatus.providerChainId = Number(celoNetwork.chainId);
            networkStatus.providerName = celoNetwork.name;
            networkStatus.blockExplorerUrl = blockchainService.getBlockExplorerUrl(
              '0x0000000000000000000000000000000000000000000000000000000000000000'
            );

            // Check if chain IDs match
            if (Number(celoNetwork.chainId) !== network.chainId) {
              networkStatus.warning = `Chain ID mismatch: expected ${network.chainId}, got ${celoNetwork.chainId}`;
            }
          } else if (network.networkFamily === NetworkFamily.SOLANA) {
            // Solana network health check
            const connection = new Connection(network.rpcUrl);
            const _version = await connection.getVersion();
            networkStatus.status = 'Connected';
            networkStatus.providerName = 'Solana';
            networkStatus.blockExplorerUrl = blockchainService.getBlockExplorerUrl(
              '1111111111111111111111111111111111111111111111111111111111111111'
            );
          }
        } catch (networkErr) {
          networkStatus.status = 'Error';
          networkStatus.error = (networkErr as Error).message;
          logError(`Health check failed for network ${network.name}`, networkErr as Error);
        }

        networksStatus.push(networkStatus);
      }
    } catch (networksErr) {
      logError('Health check failed to retrieve networks', networksErr as Error);
    }

    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      userWallet: walletAddress || 'Not Found',
      dbStatus: dbOk ? 'Connected' : 'Error',
      apiVersion: getVersionInfo(),
      contractVersion: process.env.CONTRACT_VERSION || 'unknown',
      networks: networksStatus,
      database: {
        status: dbOk ? 'Connected' : 'Error',
        counts: dbCounts,
        summary: {
          totalRecords: Object.values(dbCounts).reduce((sum, count) => sum + count, 0),
          accounts: dbCounts.accounts,
          escrows: dbCounts.escrows,
          offers: dbCounts.offers,
          trades: dbCounts.trades,
          transactions: dbCounts.transactions,
        },
      },
      summary: {
        totalNetworks: networksStatus.length,
        activeNetworks: networksStatus.filter(n => n.isActive).length,
        connectedNetworks: networksStatus.filter(n => n.status === 'Connected').length,
        errorNetworks: networksStatus.filter(n => n.status === 'Error').length,
        evmNetworks: networksStatus.filter(n => n.networkFamily === NetworkFamily.EVM).length,
        solanaNetworks: networksStatus.filter(n => n.networkFamily === NetworkFamily.SOLANA).length,
      },
    });
  })
);

export default router;
