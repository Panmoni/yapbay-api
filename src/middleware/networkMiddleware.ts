import { Request, Response, NextFunction } from 'express';
import { NetworkService } from '../services/networkService';
import {
  NetworkConfig,
  NetworkRequest,
  InvalidNetworkError,
  NetworkInactiveError,
  NetworkNotFoundError,
  NetworkType,
} from '../types/networks';

// Extend Request interface to include network context
declare global {
  namespace Express {
    interface Request extends NetworkRequest {
      network?: NetworkConfig;
      networkId?: number;
    }
  }
}

/**
 * Get all valid network names from the NetworkType enum
 */
function getValidNetworks(): string[] {
  return Object.values(NetworkType);
}

/**
 * Middleware that requires a network to be specified and validates it
 * Throws error if network is missing, invalid, or inactive
 */
export async function requireNetwork(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const network = await NetworkService.getNetworkFromRequest(req);
    req.network = network;
    req.networkId = network.id;
    next();
  } catch (error) {
    if (error instanceof InvalidNetworkError) {
      res.status(400).json({
        error: 'Invalid network specified',
        message: error.message,
        validNetworks: getValidNetworks(),
      });
      return;
    }

    if (error instanceof NetworkInactiveError) {
      res.status(503).json({
        error: 'Network unavailable',
        message: error.message,
      });
      return;
    }

    if (error instanceof NetworkNotFoundError) {
      res.status(404).json({
        error: 'Network not found',
        message: error.message,
      });
      return;
    }

    // Unexpected error
    console.error('Network middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Middleware that optionally adds network context
 * Uses default network if none specified
 * Does not throw errors for missing network header
 */
export async function optionalNetwork(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const network = await NetworkService.getNetworkFromRequest(req);
    req.network = network;
    req.networkId = network.id;
    next();
  } catch (error) {
    if (error instanceof InvalidNetworkError || error instanceof NetworkInactiveError) {
      // For optional network, fall back to default instead of erroring
      try {
        const defaultNetwork = await NetworkService.getDefaultNetwork();
        req.network = defaultNetwork;
        req.networkId = defaultNetwork.id;
        next();
      } catch (defaultError) {
        console.error('Failed to get default network:', defaultError);
        res.status(500).json({ error: 'Network configuration error' });
      }
    } else {
      console.error('Network middleware error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

/**
 * Middleware specifically for admin routes that need network context
 * Similar to requireNetwork but with admin-specific error messages
 */
export async function requireNetworkAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const networkName = req.headers['x-network-name'] as string;

    if (!networkName) {
      res.status(400).json({
        error: 'Network required',
        message: 'X-Network-Name header is required for admin operations',
        validNetworks: getValidNetworks(),
      });
      return;
    }

    const network = await NetworkService.getNetworkByName(networkName);
    if (!network) {
      res.status(400).json({
        error: 'Invalid network',
        message: `Network '${networkName}' not found`,
        validNetworks: getValidNetworks(),
      });
      return;
    }

    // For admin operations, allow inactive networks (they might need to manage them)
    req.network = network;
    req.networkId = network.id;
    next();
  } catch (error) {
    console.error('Admin network middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Middleware that validates network ID from request parameters
 * Used for routes like /admin/networks/:networkId
 */
export async function validateNetworkParam(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const networkId = parseInt(req.params.networkId);

    if (isNaN(networkId)) {
      res.status(400).json({
        error: 'Invalid network ID',
        message: 'Network ID must be a valid number',
      });
      return;
    }

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      res.status(404).json({
        error: 'Network not found',
        message: `Network with ID ${networkId} not found`,
      });
      return;
    }

    req.network = network;
    req.networkId = network.id;
    next();
  } catch (error) {
    console.error('Network param validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Middleware that adds network information to response headers
 * Useful for debugging and client-side network awareness
 */
export function addNetworkHeaders(req: Request, res: Response, next: NextFunction): void {
  if (req.network) {
    res.setHeader('X-Network-Name', req.network.name);
    res.setHeader('X-Network-Chain-Id', req.network.chainId.toString());
    res.setHeader('X-Network-Is-Testnet', req.network.isTestnet.toString());
  }
  next();
}
