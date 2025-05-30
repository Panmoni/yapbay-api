import express, { Response } from 'express';
import { query } from '../../db';
import { CeloService } from '../../celo';
import { NetworkService } from '../../services/networkService';
import { optionalNetwork } from '../../middleware/networkMiddleware';
import { withErrorHandling } from '../../middleware/errorHandler';
import { logError } from '../../logger';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { getVersionInfo } from '../../utils/versionUtils';
import { AuthenticatedRequest } from '../../middleware/auth';
import { NetworkConfig } from '../../types/networks';

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
    }
    const networksStatus: NetworkStatus[] = [];

    // Check database connectivity
    try {
      await query('SELECT 1');
      dbOk = true;
    } catch (dbErr) {
      logError('Health check DB query failed', dbErr as Error);
    }

    // Get all networks and check their status
    try {
      const allNetworks = await NetworkService.getAllNetworks();
      
      for (const network of allNetworks) {
        const networkStatus: NetworkStatus = {
          ...network,
          status: 'Unknown',
          error: null
        };

        try {
          const provider = await CeloService.getProviderForNetwork(network.id);
          const celoNetwork = await provider.getNetwork();
          networkStatus.status = 'Connected';
          networkStatus.providerChainId = Number(celoNetwork.chainId);
          networkStatus.providerName = celoNetwork.name;
          
          // Check if chain IDs match
          if (Number(celoNetwork.chainId) !== network.chainId) {
            networkStatus.warning = `Chain ID mismatch: expected ${network.chainId}, got ${celoNetwork.chainId}`;
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
      version: getVersionInfo(),
      networks: networksStatus,
      summary: {
        totalNetworks: networksStatus.length,
        activeNetworks: networksStatus.filter(n => n.isActive).length,
        connectedNetworks: networksStatus.filter(n => n.status === 'Connected').length,
        errorNetworks: networksStatus.filter(n => n.status === 'Error').length
      }
    });
  })
);

export default router;