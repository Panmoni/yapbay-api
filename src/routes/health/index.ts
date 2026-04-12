import { Connection } from '@solana/web3.js';
import express, { type Response } from 'express';
import { query } from '../../db';
import { logError } from '../../logger';
import { withErrorHandling } from '../../middleware/errorHandler';
import { optionalNetwork } from '../../middleware/networkMiddleware';
import { handler } from '../../middleware/typedHandler';
import { validate } from '../../middleware/validate';
import { validateResponse } from '../../middleware/validateResponse';
import { healthRequestSchemas, healthResponseSchema } from '../../schemas/health';
import { getListenerHealth } from '../../server';
import { BlockchainServiceFactory } from '../../services/blockchainService';
import { NetworkService } from '../../services/networkService';
import { type NetworkConfig, NetworkFamily } from '../../types/networks';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { getVersionInfo } from '../../utils/versionUtils';

const router = express.Router();

// Health Check Endpoint (Public)
router.get(
  '/',
  optionalNetwork,
  validate(healthRequestSchemas),
  validateResponse(healthResponseSchema),
  withErrorHandling(
    handler(healthRequestSchemas, async (req, res: Response): Promise<void> => {
      // Try to get wallet address if JWT is present, but don't require it
      let walletAddress: string | undefined;
      try {
        walletAddress = getWalletAddressFromJWT(req);
      } catch (_err) {
        // JWT not present or invalid - that's fine for public health check
        walletAddress = undefined;
      }
      let dbOk = false;
      interface NetworkStatus extends NetworkConfig {
        blockExplorerUrl?: string;
        error: string | null;
        providerChainId?: number;
        providerName?: string;
        status: string;
        warning?: string;
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
            accounts: Number.parseInt(accountsResult[0].count, 10),
            escrows: Number.parseInt(escrowsResult[0].count, 10),
            offers: Number.parseInt(offersResult[0].count, 10),
            trades: Number.parseInt(tradesResult[0].count, 10),
            transactions: Number.parseInt(transactionsResult[0].count, 10),
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
        const activeNetworks = allNetworks.filter((network) => network.isActive);

        for (const network of activeNetworks) {
          const networkStatus: NetworkStatus = {
            ...network,
            status: 'Unknown',
            error: null,
          };

          try {
            const blockchainService = BlockchainServiceFactory.create(network);

            // Only check Solana networks (Celo networks are inactive)
            if (network.networkFamily === NetworkFamily.SOLANA) {
              // Solana network health check
              const connection = new Connection(network.rpcUrl);
              const _version = await connection.getVersion();
              networkStatus.status = 'Connected';
              networkStatus.providerName = 'Solana';
              networkStatus.blockExplorerUrl = blockchainService.getBlockExplorerUrl(
                '1111111111111111111111111111111111111111111111111111111111111111',
              );
            } else {
              // Skip health check for inactive networks
              networkStatus.status = 'Skipped';
              networkStatus.providerName = 'Inactive';
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

      const apiVersion = await getVersionInfo();
      const listenerHealth = getListenerHealth();

      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        userWallet: walletAddress || 'Not Found',
        dbStatus: dbOk ? 'Connected' : 'Error',
        eventListeners: {
          healthy: listenerHealth.healthy,
          activeCount: listenerHealth.listenerCount,
        },
        apiVersion,
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
          activeNetworks: networksStatus.filter((n) => n.isActive).length,
          connectedNetworks: networksStatus.filter((n) => n.status === 'Connected').length,
          errorNetworks: networksStatus.filter((n) => n.status === 'Error').length,
          evmNetworks: networksStatus.filter((n) => n.networkFamily === NetworkFamily.EVM).length,
          solanaNetworks: networksStatus.filter((n) => n.networkFamily === NetworkFamily.SOLANA)
            .length,
        },
      });
    }),
  ),
);

export default router;
