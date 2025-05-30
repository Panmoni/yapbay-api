import express, { Request as ExpressRequest, Response, Router, NextFunction } from 'express';
import { query, recordTransaction } from './db';
import { CeloService } from './celo';
import { NetworkService } from './services/networkService';
import { requireNetwork, optionalNetwork } from './middleware/networkMiddleware';
import { requestLogger, logError } from './logger';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import axios from 'axios';
import { ethers } from 'ethers';
import YapBayEscrowABI from './contract/YapBayEscrow.json'; // Import ABI
import { getWalletAddressFromJWT, CustomJwtPayload, signJwt } from './utils/jwtUtils'; // Import from new util file
import bcrypt from 'bcrypt';
import adminRouter from './adminRoutes';
import { withErrorHandling } from './middleware/errorHandler';
import transactionRouter from './transactionRoutes';

// Extend Express Request interface
interface Request extends ExpressRequest {
  user?: CustomJwtPayload; // Use imported CustomJwtPayload
}

// JWT Verification Setup
const client = jwksClient({
  jwksUri:
    'https://app.dynamic.xyz/api/v0/sdk/322e23a8-06d7-445f-b525-66426d63d858/.well-known/jwks',
  rateLimit: true,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000, // 10 minutes
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
    } else {
      const signingKey = key?.getPublicKey();
      callback(null, signingKey);
    }
  });
}

const router: Router = express.Router();

// Logger must be first middleware to catch all requests
router.use((req, res, next) => {
  try {
    requestLogger(req, res, next);
  } catch (err) {
    console.error('Logger failed:', err);
    next();
  }
});

// Secure JWT Verification Middleware
const requireJWT = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }
  const decodedHeader = jwt.decode(token, { complete: true });
  if (!decodedHeader || typeof decodedHeader === 'string') {
    res.status(401).json({ error: 'Invalid token format' });
    return;
  }
  const alg = decodedHeader.header.alg;
  const verifier =
    alg === 'HS256'
      ? (cb: jwt.VerifyCallback) =>
          jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }, cb)
      : (cb: jwt.VerifyCallback) => jwt.verify(token, getKey, { algorithms: ['RS256'] }, cb);
  verifier((err, decoded) => {
    if (err) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    req.user = decoded as CustomJwtPayload;
    next();
  });
};

// Admin-only guard
const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

// Middleware to check ownership
const restrictToOwner = (resourceType: 'account' | 'offer', resourceKey: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const walletAddress = getWalletAddressFromJWT(req); // Now uses imported function
    if (!walletAddress) {
      console.error('[restrictToOwner] Failed to get wallet address from JWT for ownership check.');
      res.status(403).json({ error: 'No wallet address could be extracted from token' });
      return;
    }
    const resourceId = req.params.id || req.body[resourceKey];
    try {
      const table = resourceType === 'account' ? 'accounts' : 'offers';
      const column = resourceType === 'account' ? 'wallet_address' : 'creator_account_id';
      
      let result;
      if (resourceType === 'offer' && req.networkId) {
        // For offers, include network filtering
        result = await query(`SELECT ${column} FROM ${table} WHERE id = $1 AND network_id = $2`, [resourceId, req.networkId]);
      } else {
        // For accounts (cross-network) or when network not available
        result = await query(`SELECT ${column} FROM ${table} WHERE id = $1`, [resourceId]);
      }
      
      if (result.length === 0) {
        res.status(404).json({ error: `${resourceType} not found` });
        return;
      }
      const ownerField =
        resourceType === 'offer' ? result[0].creator_account_id : result[0].wallet_address;

      let ownerWalletAddress: string;
      if (resourceType === 'offer') {
        const accountCheck = await query('SELECT wallet_address FROM accounts WHERE id = $1', [
          ownerField,
        ]);
        if (accountCheck.length === 0) {
          res.status(404).json({ error: `Creator account for ${resourceType} not found` });
          return;
        }
        ownerWalletAddress = accountCheck[0].wallet_address;
      } else {
        ownerWalletAddress = ownerField;
      }

      if (ownerWalletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        res.status(403).json({
          error: `Unauthorized: You can only manage your own ${resourceType}s`,
        });
        return;
      }
      next();
    } catch (err) {
      logError(
        `[restrictToOwner] Error checking ownership for ${resourceType} ${resourceId}`,
        err as Error
      );
      res.status(500).json({ error: (err as Error).message });
    }
  };
};

// PUBLIC ROUTES
// TODO: rate limiting or otherwise locking it down
// /prices
router.get(
  '/prices',
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    try {
      const pricingServerUrl = process.env.PRICING_SERVER_URL;
      if (!pricingServerUrl) {
        throw new Error('PRICING_SERVER_URL not configured in .env');
      }

      const fiats = ['USD', 'COP', 'EUR', 'NGN', 'VES'];
      const pricePromises = fiats.map(fiat =>
        axios.get(`${pricingServerUrl}/price?token=USDC&fiat=${fiat}`)
      );

      const responses = await Promise.all(pricePromises);
      const prices = responses.reduce((acc, response, index) => {
        const fiat = fiats[index];
        acc[fiat] = {
          price: response.data.data.price,
          timestamp: response.data.data.timestamp,
        };
        return acc;
      }, {} as Record<string, { price: string; timestamp: number }>);

      res.json({ status: 'success', data: { USDC: prices } });
    } catch (err) {
      const error = err as Error & {
        response?: {
          status: number;
          data: { message?: string; [key: string]: unknown };
        };
      };
      logError('Failed to fetch prices', error);
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || error.message || 'Failed to fetch prices',
      });
    }
  })
);
// Get offer details (publicly accessible)
// /offers/:id
router.get(
  '/offers/:id',
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const networkId = req.networkId!;
    try {
      const result = await query('SELECT * FROM offers WHERE id = $1 AND network_id = $2', [id, networkId]);
      if (result.length === 0) {
        res.status(404).json({ error: 'Offer not found' });
        return;
      }
      res.json({
        network: req.network!.name,
        offer: result[0]
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  })
);

// List offers (publicly accessible but can filter by owner if authenticated)
// /offers
router.get(
  '/offers',
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { type, token, owner } = req.query;
    const networkId = req.networkId!;
    try {
      let sql = 'SELECT * FROM offers WHERE network_id = $1';
      const params: (string | number)[] = [networkId];

      if (type) {
        sql += ' AND offer_type = $' + (params.length + 1);
        params.push(type as string);
      }
      if (token) {
        sql += ' AND token = $' + (params.length + 1);
        params.push(token as string);
      }

      // If authenticated and requesting own offers
      const walletAddress = getWalletAddressFromJWT(req);
      if (owner === 'me' && walletAddress) {
        // console.log(`[GET /offers] Applying owner filter for wallet: ${walletAddress}`);
        sql +=
          ' AND creator_account_id IN (SELECT id FROM accounts WHERE LOWER(wallet_address) = LOWER($' +
          (params.length + 1) +
          '))';
        params.push(walletAddress);
      } else if (owner === 'me' && !walletAddress) {
        console.warn(
          '[GET /offers] owner=me filter requested but no wallet address found in token.'
        );
      }

      const result = await query(sql, params);
      res.json({
        network: req.network!.name,
        offers: result
      });
    } catch (err) {
      logError('[GET /offers] Error fetching offers', err as Error);
      res.status(500).json({ error: (err as Error).message });
    }
  })
);

// PRIVATE ROUTES
// TODO: Migrate admin credentials to a secure admin user table, add MFA, rate-limiting, and proper audit logging instead of env-based auth.
// /admin/login
router.post(
  '/admin/login',
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Missing username or password' });
      return;
    }
    if (username !== process.env.ADMIN_USERNAME) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const passwordMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH!);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = signJwt({ sub: username, role: 'admin' } as CustomJwtPayload);
    res.json({ token });
  })
);

// PRIVATE ROUTES - Require JWT
router.use(requireJWT); // Apply JWT middleware to all subsequent routes

// PRIVATE ROUTES - Admin-only guard and mount admin routes
router.use('/admin', requireAdmin, adminRouter);

// Mount transaction routes
router.use('/transactions', transactionRouter);

// Health Check Endpoint (Authenticated)
router.get(
  '/health',
  optionalNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const walletAddress = getWalletAddressFromJWT(req);
    let dbOk = false;
    const networksStatus: any[] = [];

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
        const networkStatus: any = {
          id: network.id,
          name: network.name,
          chainId: network.chainId,
          rpcUrl: network.rpcUrl,
          wsUrl: network.wsUrl,
          contractAddress: network.contractAddress,
          isTestnet: network.isTestnet,
          isActive: network.isActive,
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

// 1. Accounts Endpoints
// Create a new account
// /accounts
router.post(
  '/accounts',
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { wallet_address, username, email } = req.body;

    const jwtWalletAddress = getWalletAddressFromJWT(req);
    if (!jwtWalletAddress) {
      res.status(403).json({ error: 'No wallet address in token' });
      return;
    }
    if (wallet_address.toLowerCase() !== jwtWalletAddress.toLowerCase()) {
      res.status(403).json({ error: 'Wallet address must match authenticated user' });
      return;
    }
    if (username && username.length > 25) {
      res.status(400).json({ error: 'Username must not exceed 25 characters' });
      return;
    }

    const result = await query(
      'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
      [wallet_address, username, email]
    );
    res.status(201).json({ id: result[0].id });
  })
);

// Get account details for authenticated user
// /accounts/me
router.get(
  '/accounts/me',
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const walletAddress = getWalletAddressFromJWT(req);
    // console.log('Searching for account with wallet:', walletAddress);
    if (!walletAddress) {
      res.status(404).json({ error: 'Wallet address not found in token' });
      return;
    }
    const result = await query('SELECT * FROM accounts WHERE LOWER(wallet_address) = LOWER($1)', [
      walletAddress,
    ]);
    if (result.length === 0) {
      console.error('No account found for wallet:', walletAddress);
      res.status(404).json({
        error: 'Account not found',
        detail: `No account registered for wallet ${walletAddress}`,
      });
      return;
    }
    res.json(result[0]);
  })
);

// Retrieve specific account details (limited public view)
router.get(
  '/accounts/:id',
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const requesterWalletAddress = getWalletAddressFromJWT(req);

    try {
      // Fetch only necessary fields initially
      const result = await query(
        'SELECT id, username, wallet_address, email, telegram_username, telegram_id, profile_photo_url, phone_country_code, phone_number, available_from, available_to, timezone, created_at FROM accounts WHERE id = $1',
        [id]
      );
      if (result.length === 0) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }
      const accountData = result[0];

      // Check if the requester is the owner of the account
      if (
        requesterWalletAddress &&
        accountData.wallet_address.toLowerCase() === requesterWalletAddress.toLowerCase()
      ) {
        // Requester is the owner, return full details
        res.json(accountData);
      } else {
        // Requester is not the owner, return limited public details
        const publicProfile = {
          id: accountData.id,
          username: accountData.username,
          wallet_address: accountData.wallet_address,
          telegram_username: accountData.telegram_username,
          telegram_id: accountData.telegram_id,
          profile_photo_url: accountData.profile_photo_url,
          available_from: accountData.available_from,
          available_to: accountData.available_to,
          timezone: accountData.timezone,
          created_at: accountData.created_at,
          // Explicitly exclude sensitive fields: wallet_address, email, telegram_*, phone_*
        };
        res.json(publicProfile);
      }
    } catch (err) {
      logError(`Error fetching account ${id}`, err as Error);
      res.status(500).json({ error: (err as Error).message });
    }
  })
);

// Update account info (restricted to owner)
router.put(
  '/accounts/:id',
  restrictToOwner('account', 'id'),
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const {
      username,
      email,
      telegram_username,
      telegram_id,
      profile_photo_url,
      phone_country_code,
      phone_number,
      available_from,
      available_to,
      timezone,
    } = req.body;
    try {
      const result = await query(
        `UPDATE accounts SET
        username = COALESCE($1, username),
        email = COALESCE($2, email),
        telegram_username = COALESCE($3, telegram_username),
        telegram_id = COALESCE($4, telegram_id),
        profile_photo_url = COALESCE($5, profile_photo_url),
        phone_country_code = COALESCE($6, phone_country_code),
        phone_number = COALESCE($7, phone_number),
        available_from = COALESCE($8, available_from),
        available_to = COALESCE($9, available_to),
        timezone = COALESCE($10, timezone)
      WHERE id = $11 RETURNING id`,
        [
          username || null,
          email || null,
          telegram_username || null,
          telegram_id || null,
          profile_photo_url || null,
          phone_country_code || null,
          phone_number || null,
          available_from || null,
          available_to || null,
          timezone || null,
          id,
        ]
      );
      if (result.length === 0) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }
      res.json({ id: result[0].id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  })
);

// 2. Offers Endpoints
// Create a new offer (restricted to creator's account)
router.post(
  '/offers',
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { creator_account_id, offer_type, min_amount, fiat_currency = 'USD' } = req.body;
    const networkId = req.networkId!;
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    if (!jwtWalletAddress) {
      res.status(403).json({ error: 'No wallet address in token' });
      return;
    }
    if (!['BUY', 'SELL'].includes(offer_type)) {
      res.status(400).json({ error: 'Offer type must be BUY or SELL' });
      return;
    }
    if (!/^[A-Z]{3}$/.test(fiat_currency)) {
      res.status(400).json({ error: 'Fiat currency must be a 3-letter uppercase code' });
      return;
    }
    if (typeof min_amount !== 'number' || min_amount < 0) {
      res.status(400).json({ error: 'Min amount must be a non-negative number' });
      return;
    }
    if (min_amount > 1000000) {
      res.status(400).json({ error: 'Min amount must not exceed 1,000,000' });
      return;
    }

    const accountCheck = await query('SELECT wallet_address FROM accounts WHERE id = $1', [
      creator_account_id,
    ]);
    if (
      accountCheck.length === 0 ||
      accountCheck[0].wallet_address.toLowerCase() !== jwtWalletAddress.toLowerCase()
    ) {
      res
        .status(403)
        .json({ error: 'Unauthorized: You can only create offers for your own account' });
      return;
    }
    const result = await query(
      'INSERT INTO offers (creator_account_id, offer_type, token, fiat_currency, min_amount, max_amount, total_available_amount, rate_adjustment, terms, escrow_deposit_time_limit, fiat_payment_time_limit, network_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
      [
        creator_account_id,
        offer_type,
        req.body.token || 'USDC',
        fiat_currency,
        min_amount,
        req.body.max_amount || min_amount * 2,
        req.body.total_available_amount || min_amount * 4,
        req.body.rate_adjustment || 1.05,
        req.body.terms || 'Cash only',
        '15 minutes',
        '30 minutes',
        networkId,
      ]
    );
    res.status(201).json({
      network: req.network!.name,
      offer: result[0]
    });
  })
);

// Update an offer (restricted to creator)
router.put(
  '/offers/:id',
  requireNetwork,
  restrictToOwner('offer', 'id'),
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const networkId = req.networkId!;
    try {
      const {
        min_amount,
        max_amount,
        total_available_amount,
        rate_adjustment,
        terms,
        escrow_deposit_time_limit,
        fiat_payment_time_limit,
        fiat_currency,
        offer_type,
        token,
      } = req.body;

      const formatTimeLimit = (limit: undefined | null | string | { minutes: number }) => {
        if (!limit) return null;
        if (typeof limit === 'string') return limit;
        if (limit.minutes) return `${limit.minutes} minutes`;
        return null;
      };

      const result = await query(
        `UPDATE offers SET
        min_amount = COALESCE($1, min_amount),
        max_amount = COALESCE($2, max_amount),
        total_available_amount = COALESCE($3, total_available_amount),
        rate_adjustment = COALESCE($4, rate_adjustment),
        terms = COALESCE($5, terms),
        escrow_deposit_time_limit = COALESCE($6::interval, escrow_deposit_time_limit),
        fiat_payment_time_limit = COALESCE($7::interval, fiat_payment_time_limit),
        fiat_currency = COALESCE($8, fiat_currency),
        offer_type = COALESCE($9, offer_type),
        token = COALESCE($10, token),
        updated_at = NOW()
      WHERE id = $11 AND network_id = $12 RETURNING *`,
        [
          min_amount || null,
          max_amount || null,
          total_available_amount || null,
          rate_adjustment || null,
          terms || null,
          formatTimeLimit(escrow_deposit_time_limit),
          formatTimeLimit(fiat_payment_time_limit),
          fiat_currency || null,
          offer_type || null,
          token || null,
          id,
          networkId,
        ]
      );
      
      if (result.length === 0) {
        res.status(404).json({ error: 'Offer not found' });
        return;
      }
      
      res.json({ 
        network: req.network!.name,
        offer: result[0] 
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  })
);

// Delete an offer (restricted to creator)
router.delete(
  '/offers/:id',
  requireNetwork,
  restrictToOwner('offer', 'id'),
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const networkId = req.networkId!;
    try {
      // First check if the offer exists and is owned by the caller
      const offerCheck = await query('SELECT id FROM offers WHERE id = $1 AND network_id = $2', [id, networkId]);
      if (offerCheck.length === 0) {
        res.status(404).json({ error: 'Offer not found' });
        return;
      }

      // Check for active trades referencing this offer on this network
      const activeTrades = await query(
        "SELECT id FROM trades WHERE leg1_offer_id = $1 AND network_id = $2 AND overall_status NOT IN ('COMPLETED', 'CANCELLED')",
        [id, networkId]
      );

      if (activeTrades.length > 0) {
        res.status(400).json({
          error: `Cannot delete - ${activeTrades.length} active trades exist`,
          active_trades: activeTrades.length,
        });
        return;
      }

      // Proceed with deletion
      const result = await query('DELETE FROM offers WHERE id = $1 AND network_id = $2 RETURNING id', [id, networkId]);

      if (result.length === 0) {
        res.status(500).json({ error: 'Unexpected error deleting offer' });
        return;
      }

      res.json({ message: 'Offer deleted' });
    } catch (err) {
      const error = err as Error & { code?: string };

      if (error.code === '23503') {
        // Foreign key violation
        res.status(400).json({
          error: 'Cannot delete offer - it is referenced by other records',
          details: error.message,
        });
      } else {
        res.status(500).json({
          error: 'Internal server error',
          details: error.message,
        });
      }
    }
  })
);

// 3. Trades Endpoints
// Initiate a trade (requires JWT but no ownership check yet—open to any authenticated user)
router.post(
  '/trades',
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    console.log('POST /trades - Request body:', JSON.stringify(req.body));
    const {
      leg1_offer_id,
      leg2_offer_id,
      leg1_crypto_amount,
      leg1_fiat_amount,
      from_fiat_currency,
      destination_fiat_currency,
      from_bank,
      destination_bank,
    } = req.body;
    const networkId = req.networkId!;
    console.log('Extracted values:', {
      leg1_offer_id,
      leg1_crypto_amount,
      leg1_fiat_amount,
      from_fiat_currency,
      destination_fiat_currency,
    });

    const jwtWalletAddress = getWalletAddressFromJWT(req);
    console.log('JWT wallet address:', jwtWalletAddress);
    if (!jwtWalletAddress) {
      res.status(403).json({ error: 'No wallet address in token' });
      return;
    }

    const leg1Offer = await query('SELECT * FROM offers WHERE id = $1 AND network_id = $2', [leg1_offer_id, networkId]);
    console.log(
      'Leg1 offer query result:',
      leg1Offer.length > 0 ? JSON.stringify(leg1Offer[0]) : 'Not found'
    );
    if (leg1Offer.length === 0) {
      res.status(404).json({ error: 'Leg 1 offer not found' });
      return;
    }

    // Convert string values to numbers for proper comparison
    const totalAvailable = parseFloat(leg1Offer[0].total_available_amount);
    const offerMinAmount = parseFloat(leg1Offer[0].min_amount);

    console.log('Comparing values:', {
      totalAvailable,
      offerMinAmount,
      comparison: totalAvailable < offerMinAmount,
    });

    if (totalAvailable < offerMinAmount) {
      console.log(
        'Offer no longer available. total_available_amount:',
        totalAvailable,
        'min_amount:',
        offerMinAmount
      );
      res.status(400).json({ error: 'Offer no longer available' });
      return;
    }

    const creatorAccount = await query('SELECT id, wallet_address FROM accounts WHERE id = $1', [
      leg1Offer[0].creator_account_id,
    ]);
    console.log(
      'Creator account:',
      creatorAccount.length > 0 ? JSON.stringify(creatorAccount[0]) : 'Not found'
    );

    const buyerAccount = await query('SELECT id FROM accounts WHERE wallet_address = $1', [
      jwtWalletAddress,
    ]);
    console.log(
      'Buyer account:',
      buyerAccount.length > 0 ? JSON.stringify(buyerAccount[0]) : 'Not found'
    );

    if (buyerAccount.length === 0) {
      res.status(403).json({ error: 'Buyer account not found' });
      return;
    }

    const amountToSubtract = parseFloat(leg1_crypto_amount || leg1Offer[0].min_amount);
    const newTotalAvailable = parseFloat(leg1Offer[0].total_available_amount) - amountToSubtract;
    const maxAmount = parseFloat(leg1Offer[0].max_amount);
    const minAmount = parseFloat(leg1Offer[0].min_amount);

    console.log('Amount calculations:', {
      amountToSubtract,
      newTotalAvailable,
      maxAmount,
      minAmount,
      total_available_amount: parseFloat(leg1Offer[0].total_available_amount),
    });

    if (newTotalAvailable < 0) {
      res.status(400).json({ error: 'Insufficient available amount for this trade' });
      return;
    }

    const isSeller = leg1Offer[0].offer_type === 'SELL';
    const leg1SellerAccountId = isSeller ? creatorAccount[0].id : buyerAccount[0].id;
    const leg1BuyerAccountId = isSeller ? buyerAccount[0].id : creatorAccount[0].id;

    console.log('Trade roles:', {
      isSeller,
      leg1SellerAccountId,
      leg1BuyerAccountId,
      offer_type: leg1Offer[0].offer_type,
    });

    if (leg1SellerAccountId === leg1BuyerAccountId) {
      res.status(400).json({ error: 'Cannot create a trade with your own offer' });
      return;
    }

    // Declare result variable outside the try block so it's accessible in the scope
    let result;

    try {
      console.log('Attempting to insert trade with params:', {
        leg1_offer_id,
        leg2_offer_id: leg2_offer_id || null,
        from_fiat_currency: from_fiat_currency || leg1Offer[0].fiat_currency,
        destination_fiat_currency: destination_fiat_currency || leg1Offer[0].fiat_currency,
        leg1SellerAccountId,
        leg1BuyerAccountId,
        token: leg1Offer[0].token,
        leg1_crypto_amount: leg1_crypto_amount || leg1Offer[0].min_amount,
        leg1_fiat_currency: leg1Offer[0].fiat_currency,
        leg1_fiat_amount: leg1_fiat_amount || null,
      });

      result = await query(
        `INSERT INTO trades (
        leg1_offer_id, leg2_offer_id, overall_status, from_fiat_currency, destination_fiat_currency, from_bank, destination_bank,
        leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_token, leg1_crypto_amount, leg1_fiat_currency, leg1_fiat_amount,
        leg1_escrow_deposit_deadline, leg1_fiat_payment_deadline, network_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        NOW() + $15::interval, NOW() + $16::interval, $17
      ) RETURNING *`,
        [
          leg1_offer_id,
          leg2_offer_id || null,
          'IN_PROGRESS',
          from_fiat_currency || leg1Offer[0].fiat_currency,
          destination_fiat_currency || leg1Offer[0].fiat_currency,
          from_bank || null,
          destination_bank || null,
          'CREATED',
          leg1SellerAccountId,
          leg1BuyerAccountId,
          leg1Offer[0].token,
          leg1_crypto_amount || leg1Offer[0].min_amount,
          leg1Offer[0].fiat_currency,
          leg1_fiat_amount || null,
          leg1Offer[0].escrow_deposit_time_limit, // $15
          leg1Offer[0].fiat_payment_time_limit, // $16
          networkId, // $17
        ]
      );

      console.log('Trade created successfully:', result[0]);
    } catch (error) {
      console.error('Error creating trade:', error);
      throw error;
    }

    if (newTotalAvailable < maxAmount) {
      if (newTotalAvailable < minAmount) {
        await query(
          'UPDATE offers SET total_available_amount = $1, max_amount = $1, min_amount = $1 WHERE id = $2',
          [newTotalAvailable, leg1_offer_id]
        );
      } else {
        await query(
          'UPDATE offers SET total_available_amount = $1, max_amount = $1 WHERE id = $2',
          [newTotalAvailable, leg1_offer_id]
        );
      }
    } else {
      await query(
        'UPDATE offers SET total_available_amount = total_available_amount - $1 WHERE id = $2',
        [amountToSubtract, leg1_offer_id]
      );
    }

    res.status(201).json({
      network: req.network!.name,
      trade: result[0]
    });
  })
);
// List trades for authenticated user
router.get(
  '/my/trades',
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    const networkId = req.networkId!;
    
    if (!jwtWalletAddress) {
      res.status(404).json({ error: 'Wallet address not found in token' });
      return;
    }
    const result = await query(
      'SELECT t.* FROM trades t JOIN accounts a ON t.leg1_seller_account_id = a.id OR t.leg1_buyer_account_id = a.id WHERE LOWER(a.wallet_address) = LOWER($1) AND t.network_id = $2 ORDER BY t.created_at DESC',
      [jwtWalletAddress, networkId]
    );
    
    // Find the most recently updated trade
    const lastModifiedTime = result.length > 0 
      ? Math.max(...result.map(trade => trade.updated_at?.getTime() || 0))
      : Date.now();
    const lastModified = new Date(lastModifiedTime);
    const lastModifiedStr = lastModified.toUTCString();
    
    // Generate ETag based on result data
    const etag = `W/"${lastModifiedTime}-${JSON.stringify(result).length}"`;
    
    // Check if client has the latest version using ETag
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end(); // Not Modified
      return;
    }
    
    // Check if client has the latest version using Last-Modified
    if (req.headers['if-modified-since']) {
      const ifModifiedSince = new Date(req.headers['if-modified-since'] as string);
      if (lastModified <= ifModifiedSince) {
        res.status(304).end(); // Not Modified
        return;
      }
    }
    
    // Set ETag and Last-Modified headers
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModifiedStr);
    res.setHeader('Cache-Control', 'private, must-revalidate');
    
    res.json({
      network: req.network!.name,
      trades: result
    });
  })
);

// Get escrow balance by onchain escrow ID
router.get(
  '/escrows/:onchainEscrowId/balance',
  requireJWT,
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { onchainEscrowId } = req.params;
    const networkId = req.networkId!;
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    
    if (!jwtWalletAddress) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Verify the user is involved in this escrow on this network
    const escrowCheck = await query(
      `SELECT e.* FROM escrows e
       WHERE e.onchain_escrow_id = $1 AND e.network_id = $2
       AND (LOWER(e.seller_address) = LOWER($3) OR LOWER(e.buyer_address) = LOWER($3))`,
      [onchainEscrowId, networkId, jwtWalletAddress]
    );

    if (escrowCheck.length === 0) {
      res.status(404).json({ error: 'Escrow not found or access denied' });
      return;
    }

    try {
      const balance = await CeloService.getEscrowBalance(networkId, parseInt(onchainEscrowId));
      res.json({
        network: req.network!.name,
        escrowId: onchainEscrowId,
        balance
      });
    } catch (error) {
      console.error('Error fetching escrow balance:', error);
      res.status(500).json({ error: 'Failed to fetch escrow balance' });
    }
  })
);

// Get stored escrow balance from contract
router.get(
  '/escrows/:onchainEscrowId/stored-balance',
  requireJWT,
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { onchainEscrowId } = req.params;
    const networkId = req.networkId!;
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    
    if (!jwtWalletAddress) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Verify the user is involved in this escrow on this network
    const escrowCheck = await query(
      `SELECT e.* FROM escrows e
       WHERE e.onchain_escrow_id = $1 AND e.network_id = $2
       AND (LOWER(e.seller_address) = LOWER($3) OR LOWER(e.buyer_address) = LOWER($3))`,
      [onchainEscrowId, networkId, jwtWalletAddress]
    );

    if (escrowCheck.length === 0) {
      res.status(404).json({ error: 'Escrow not found or access denied' });
      return;
    }

    try {
      const contract = await CeloService.getContractForNetwork(networkId);
      const stored = await contract.getStoredEscrowBalance(onchainEscrowId);

      res.json({
        escrowId: onchainEscrowId,
        storedBalance: ethers.formatUnits(stored, 6)
      });
    } catch (error) {
      console.error('Error fetching stored escrow balance:', error);
      res.status(500).json({ error: 'Failed to fetch stored escrow balance' });
    }
  })
);

// Get calculated escrow balance from contract
router.get(
  '/escrows/:onchainEscrowId/calculated-balance',
  requireJWT,
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { onchainEscrowId } = req.params;
    const networkId = req.networkId!;
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    
    if (!jwtWalletAddress) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Verify the user is involved in this escrow on this network
    const escrowCheck = await query(
      `SELECT e.* FROM escrows e
       WHERE e.onchain_escrow_id = $1 AND e.network_id = $2
       AND (LOWER(e.seller_address) = LOWER($3) OR LOWER(e.buyer_address) = LOWER($3))`,
      [onchainEscrowId, networkId, jwtWalletAddress]
    );

    if (escrowCheck.length === 0) {
      res.status(404).json({ error: 'Escrow not found or access denied' });
      return;
    }

    try {
      const contract = await CeloService.getContractForNetwork(networkId);
      const calculated = await contract.getCalculatedEscrowBalance(onchainEscrowId);

      res.json({
        escrowId: onchainEscrowId,
        calculatedBalance: ethers.formatUnits(calculated, 6)
      });
    } catch (error) {
      console.error('Error fetching calculated escrow balance:', error);
      res.status(500).json({ error: 'Failed to fetch calculated escrow balance' });
    }
  })
);

// Get sequential escrow information
router.get(
  '/escrows/:onchainEscrowId/sequential-info',
  requireJWT,
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { onchainEscrowId } = req.params;
    const networkId = req.networkId!;
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    
    if (!jwtWalletAddress) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Verify the user is involved in this escrow on this network
    const escrowCheck = await query(
      `SELECT e.* FROM escrows e
       WHERE e.onchain_escrow_id = $1 AND e.network_id = $2
       AND (LOWER(e.seller_address) = LOWER($3) OR LOWER(e.buyer_address) = LOWER($3))`,
      [onchainEscrowId, networkId, jwtWalletAddress]
    );

    if (escrowCheck.length === 0) {
      res.status(404).json({ error: 'Escrow not found or access denied' });
      return;
    }

    try {
      const sequentialInfo = await CeloService.getSequentialInfo(networkId, parseInt(onchainEscrowId));
      
      res.json({
        network: req.network!.name,
        escrowId: onchainEscrowId,
        sequentialInfo
      });
    } catch (error) {
      console.error('Error fetching sequential escrow info:', error);
      res.status(500).json({ error: 'Failed to fetch sequential escrow info' });
    }
  })
);

// Check if escrow is eligible for auto-cancellation
router.get(
  '/escrows/:onchainEscrowId/auto-cancel-eligible',
  requireJWT,
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { onchainEscrowId } = req.params;
    const networkId = req.networkId!;
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    
    if (!jwtWalletAddress) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Verify the user is involved in this escrow on this network
    const escrowCheck = await query(
      `SELECT e.* FROM escrows e
       WHERE e.onchain_escrow_id = $1 AND e.network_id = $2
       AND (LOWER(e.seller_address) = LOWER($3) OR LOWER(e.buyer_address) = LOWER($3))`,
      [onchainEscrowId, networkId, jwtWalletAddress]
    );

    if (escrowCheck.length === 0) {
      res.status(404).json({ error: 'Escrow not found or access denied' });
      return;
    }

    try {
      const isEligible = await CeloService.checkAutoCancelEligible(networkId, parseInt(onchainEscrowId));
      
      res.json({
        escrowId: onchainEscrowId,
        isEligibleForAutoCancel: isEligible
      });
    } catch (error) {
      console.error('Error checking auto-cancel eligibility:', error);
      res.status(500).json({ error: 'Failed to check auto-cancel eligibility' });
    }
  })
);

// List escrows for authenticated user
router.get(
  '/my/escrows',
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    const networkId = req.networkId!;
    
    if (!jwtWalletAddress) {
      res.status(404).json({ error: 'Wallet address not found in token' });
      return;
    }
    const result = await query(
      `SELECT e.* FROM escrows e
       WHERE e.network_id = $1 
       AND (LOWER(e.seller_address) = LOWER($2) OR LOWER(e.buyer_address) = LOWER($2))
       ORDER BY e.created_at DESC`,
      [networkId, jwtWalletAddress]
    );
    res.json(result);
  })
);

// Get trade details (restricted to participants)
router.get(
  '/trades/:id',
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const networkId = req.networkId!;
    const requesterWalletAddress = getWalletAddressFromJWT(req);

    if (!requesterWalletAddress) {
      // Should be caught by requireJWT, but handle defensively
      res.status(401).json({ error: 'Authentication required to view trade details' });
      return;
    }

    try {
      // Fetch trade data including all potential participant account IDs
      const tradeResult = await query(
        'SELECT *, leg1_seller_account_id, leg1_buyer_account_id, leg2_seller_account_id, leg2_buyer_account_id FROM trades WHERE id = $1 AND network_id = $2',
        [id, networkId]
      );
      if (tradeResult.length === 0) {
        res.status(404).json({ error: 'Trade not found' });
        return;
      }
      const tradeData = tradeResult[0];

      // Collect unique, non-null participant account IDs
      const participantAccountIds = [
        tradeData.leg1_seller_account_id,
        tradeData.leg1_buyer_account_id,
        tradeData.leg2_seller_account_id,
        tradeData.leg2_buyer_account_id,
      ].filter((accountId): accountId is number => accountId !== null && accountId !== undefined); // Filter out nulls and ensure type is number

      const uniqueParticipantAccountIds = [...new Set(participantAccountIds)];

      if (uniqueParticipantAccountIds.length === 0) {
        // Should not happen if trade exists, but handle defensively
        logError(
          `Trade ${id} has no valid participant account IDs.`,
          new Error('Missing participant account IDs in trade data')
        );
        res.status(500).json({ error: 'Internal server error processing trade participants' });
        return;
      }

      // Fetch wallet addresses for all participants in one query
      const accountsResult = await query(
        'SELECT id, wallet_address FROM accounts WHERE id = ANY($1::int[])',
        [uniqueParticipantAccountIds]
      );

      // Create a set of participant wallet addresses (lowercase)
      const participantWallets = new Set(
        accountsResult.map(acc => acc.wallet_address.toLowerCase())
      );

      // Check if the requester is a participant
      if (participantWallets.has(requesterWalletAddress.toLowerCase())) {
        // Get the last modified timestamp
        const lastModified = tradeData.updated_at || new Date();
        const lastModifiedStr = lastModified.toUTCString();
        
        // Generate ETag based on trade data for conditional requests
        const etag = `W/"${lastModified.getTime()}-${JSON.stringify(tradeData).length}"`;
        
        // Check if client has the latest version using ETag
        if (req.headers['if-none-match'] === etag) {
          res.status(304).end(); // Not Modified
          return;
        }
        
        // Check if client has the latest version using Last-Modified
        if (req.headers['if-modified-since']) {
          const ifModifiedSince = new Date(req.headers['if-modified-since'] as string);
          if (lastModified <= ifModifiedSince) {
            res.status(304).end(); // Not Modified
            return;
          }
        }
        
        // Set ETag and Last-Modified headers
        res.setHeader('ETag', etag);
        res.setHeader('Last-Modified', lastModifiedStr);
        res.setHeader('Cache-Control', 'private, must-revalidate');
        
        // Requester is a participant, return full trade details
        res.json({
          network: req.network!.name,
          trade: tradeData
        });
      } else {
        // Requester is not a participant, return 403 Forbidden
        res.status(403).json({ error: 'Forbidden: You are not authorized to view this trade' });
      }
    } catch (err) {
      logError(`Error fetching trade ${id} or checking participation`, err as Error);
      res.status(500).json({ error: (err as Error).message });
    }
  })
);

// Update trade info (restricted to trade participants)
router.put(
  '/trades/:id',
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { leg1_state, overall_status, fiat_paid } = req.body;
    const networkId = req.networkId!;

    const jwtWalletAddress = getWalletAddressFromJWT(req);
    if (!jwtWalletAddress) {
      res.status(403).json({ error: 'No wallet address in token' });
      return;
    }

    const trade = await query('SELECT * FROM trades WHERE id = $1 AND network_id = $2', [id, networkId]);
    if (trade.length === 0) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }

    const sellerWallet = await query('SELECT wallet_address FROM accounts WHERE id = $1', [
      trade[0].leg1_seller_account_id,
    ]);
    const buyerWallet = await query('SELECT wallet_address FROM accounts WHERE id = $1', [
      trade[0].leg1_buyer_account_id,
    ]);

    const isParticipant =
      (sellerWallet.length > 0 &&
        sellerWallet[0].wallet_address.toLowerCase() === jwtWalletAddress.toLowerCase()) ||
      (buyerWallet.length > 0 &&
        buyerWallet[0].wallet_address.toLowerCase() === jwtWalletAddress.toLowerCase());

    if (!isParticipant) {
      res.status(403).json({ error: 'Unauthorized: Only trade participants can update' });
      return;
    }

    if (fiat_paid === true) {
      await query(
        'UPDATE trades SET leg1_fiat_paid_at = NOW() WHERE id = $1 AND leg1_fiat_paid_at IS NULL',
        [id]
      );
    } else if (fiat_paid === false) {
      await query('UPDATE trades SET leg1_fiat_paid_at = NULL WHERE id = $1', [id]);
    }

    const updateFields: string[] = [];
    const updateParams: unknown[] = [];
    let paramIndex = 1;

    if (leg1_state !== undefined) {
      updateFields.push(`leg1_state = $${paramIndex++}`);
      updateParams.push(leg1_state);
    }
    if (overall_status !== undefined) {
      updateFields.push(`overall_status = $${paramIndex++}`);
      updateParams.push(overall_status);
    }

    if (updateFields.length > 0) {
      updateParams.push(id);
      const sql = `UPDATE trades SET ${updateFields.join(
        ', '
      )} WHERE id = $${paramIndex} RETURNING id`;
      const result = await query(sql, updateParams);
      if (result.length > 0) {
        res.json({ id: result[0].id });
      } else {
        res.status(404).json({ error: 'Trade not found during update' });
      }
    } else if (fiat_paid !== undefined) {
      res.json({ id: parseInt(id, 10) });
    } else {
      res.status(400).json({ error: 'No fields provided for update' });
    }
  })
);

router.post(
  '/escrows/record',
  requireJWT,
  requireNetwork,
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    const {
      trade_id,
      transaction_hash,
      escrow_id,
      seller,
      buyer,
      amount,
      sequential,
      sequential_escrow_address,
    } = req.body;
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    const networkId = req.networkId!;

    const network = await NetworkService.getNetworkById(networkId);
    if (!network) {
      res.status(400).json({ error: 'Invalid network' });
      return;
    }
    const CONTRACT_ADDRESS = network.contractAddress;
    if (!CONTRACT_ADDRESS) {
      logError(
        'CONTRACT_ADDRESS environment variable not set',
        new Error('CONTRACT_ADDRESS not set')
      );
      res.status(500).json({ error: 'Server configuration error: Contract address not set' });
      return;
    }

    if (!jwtWalletAddress) {
      res.status(403).json({ error: 'No wallet address in token' });
      return;
    }

    if (!seller || jwtWalletAddress.toLowerCase() !== seller.toLowerCase()) {
      res.status(403).json({ error: 'Seller must match authenticated user and be provided' });
      return;
    }

    if (!transaction_hash || !ethers.isHexString(transaction_hash)) {
      res.status(400).json({ error: 'Valid transaction_hash must be provided' });
      return;
    }

    if (!Number.isInteger(Number(trade_id))) {
      res.status(400).json({ error: 'trade_id must be an integer' });
      return;
    }

    // Validate escrow_id is a valid integer
    if (!escrow_id || isNaN(Number(escrow_id)) || Number(escrow_id) <= 0) {
      res.status(400).json({ error: 'Valid escrow_id must be provided as a positive integer' });
      return;
    }

    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: 'amount must be a positive number' });
      return;
    }

    try {
      if (!ethers.isAddress(buyer)) {
        res.status(400).json({ error: 'buyer must be a valid Ethereum address' });
        return;
      }

      if (sequential === true && !sequential_escrow_address) {
        res
          .status(400)
          .json({ error: 'sequential_escrow_address must be provided when sequential is true' });
        return;
      }

      if (sequential_escrow_address && !ethers.isAddress(sequential_escrow_address)) {
        res
          .status(400)
          .json({ error: 'sequential_escrow_address must be a valid Ethereum address' });
        return;
      }

      // Verify the trade exists
      const tradeCheck = await query('SELECT * FROM trades WHERE id = $1 AND network_id = $2', [trade_id, networkId]);
      if (tradeCheck.length === 0) {
        res.status(404).json({ error: 'Trade not found' });
        return;
      }

      // Verify the transaction on the blockchain
      try {
        const defaultNetwork = await NetworkService.getDefaultNetwork();
        const provider = await CeloService.getProviderForNetwork(defaultNetwork.id);
        const txReceipt = await provider.getTransactionReceipt(transaction_hash);

        if (!txReceipt || txReceipt.status !== 1) {
          res.status(400).json({
            error: 'Transaction not found or failed on the blockchain',
            details: txReceipt ? `Status: ${txReceipt.status}` : 'Receipt not found',
          });
          return;
        }

        // Verify this is a transaction to our contract
        if (txReceipt.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
          res.status(400).json({
            error: 'Transaction is not for the YapBay escrow contract',
            details: `Transaction to: ${txReceipt.to}, expected: ${CONTRACT_ADDRESS}`,
          });
          return;
        }

        // Parse logs to verify EscrowCreated event
        let escrowCreatedEvent = false;
        let verifiedEscrowId: string | null = null;

        if (txReceipt.logs) {
          const escrowCreatedInterface = new ethers.Interface(YapBayEscrowABI.abi);
          for (const log of txReceipt.logs) {
            if (log.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()) {
              try {
                const parsedLog = escrowCreatedInterface.parseLog({
                  topics: log.topics as string[],
                  data: log.data,
                });

                if (parsedLog && parsedLog.name === 'EscrowCreated') {
                  escrowCreatedEvent = true;

                  // Get the numeric value of the escrow ID from the transaction
                  const txEscrowIdBigInt = parsedLog.args.escrowId;
                  verifiedEscrowId = txEscrowIdBigInt.toString();

                  // Convert the provided escrow_id to a number for comparison
                  const providedEscrowIdNum = BigInt(escrow_id);

                  console.log(`[DEBUG /escrows/record] Comparing Escrow IDs:`);
                  console.log(`  - Transaction Escrow ID (BigInt): ${txEscrowIdBigInt}`);
                  console.log(`  - Provided Escrow ID (BigInt): ${providedEscrowIdNum}`);

                  // Compare the numeric values directly
                  if (txEscrowIdBigInt !== providedEscrowIdNum) {
                    res.status(400).json({
                      error: 'Escrow ID in transaction does not match provided escrow_id',
                      details: `Transaction escrow ID: ${verifiedEscrowId} (integer), provided: ${escrow_id} (integer)`,
                    });
                    return;
                  }

                  // Verify the trade ID matches
                  if (parsedLog.args.tradeId.toString() !== trade_id.toString()) {
                    res.status(400).json({
                      error: 'Trade ID in transaction does not match provided trade_id',
                      details: `Transaction trade ID: ${parsedLog.args.tradeId}, provided: ${trade_id}`,
                    });
                    return;
                  }

                  break;
                }
              } catch (e) {
                logError('Error parsing transaction log', e);
                // Continue despite parsing errors for non-matching logs
              }
            }
          }
        }

        if (!escrowCreatedEvent || !verifiedEscrowId) {
          res.status(400).json({
            error: 'Transaction does not contain a valid EscrowCreated event',
            details: 'Could not find or parse the EscrowCreated event in transaction logs',
          });
          return;
        }

        // Update the trade with escrow information, including the on-chain escrow ID
        await query(
          'UPDATE trades SET leg1_escrow_address = $1, leg1_state = $2, leg1_escrow_onchain_id = $3 WHERE id = $4',
          [CONTRACT_ADDRESS, 'FUNDED', verifiedEscrowId, trade_id]
        );

        // Check if an escrow with this onchain_escrow_id already exists
        const existingEscrow = await query(
          'SELECT id FROM escrows WHERE onchain_escrow_id = $1',
          [verifiedEscrowId]
        );

        let escrowDbId;

        if (existingEscrow.length > 0) {
          // Escrow already exists - update it instead of creating a duplicate
          escrowDbId = existingEscrow[0].id;
          await query(
            'UPDATE escrows SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['FUNDED', escrowDbId]
          );
          console.log(`Updated existing escrow id=${escrowDbId} with onchain_escrow_id=${verifiedEscrowId} to state=FUNDED`);
        } else {
          // Record the escrow in the database and get its ID
          const escrowInsertResult = await query(
            'INSERT INTO escrows (trade_id, escrow_address, seller_address, buyer_address, arbitrator_address, token_type, amount, state, sequential, sequential_escrow_address, onchain_escrow_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
            [
              trade_id,
              CONTRACT_ADDRESS, // Using the main contract address as the escrow identifier for now
              seller,
              buyer,
              process.env.ARBITRATOR_ADDRESS, // Assuming a fixed arbitrator for now
              'USDC', // Assuming USDC
              Number(amount) / 1_000_000, // Convert blockchain amount (with 6 decimals) to database decimal format
              'FUNDED', // State after successful recording
              sequential || false,
              sequential_escrow_address || null,
              verifiedEscrowId, // Store the blockchain escrow ID in the new column
            ]
          );

          if (escrowInsertResult.length === 0 || !escrowInsertResult[0].id) {
            logError(
              `Failed to insert escrow record for trade ${trade_id} and tx ${transaction_hash}`,
              new Error('Escrow insertion failed to return ID')
            );
            // Don't record transaction if escrow insert failed
            res.status(500).json({ error: 'Failed to record escrow in database' });
            return; // Stop execution
          }

          escrowDbId = escrowInsertResult[0].id;
        }

        // Create a mapping record to help with ID synchronization if it doesn't exist
        await query(
          'INSERT INTO escrow_id_mapping (blockchain_id, database_id) VALUES ($1, $2) ON CONFLICT (blockchain_id) DO UPDATE SET database_id = $2',
          [verifiedEscrowId, escrowDbId]
        );
        // Record the successful blockchain transaction
        await recordTransaction({
          transaction_hash: txReceipt.hash,
          status: 'SUCCESS',
          type: 'CREATE_ESCROW', // This endpoint confirms creation
          block_number: txReceipt.blockNumber,
          sender_address: txReceipt.from, // The address that sent the tx (seller)
          receiver_or_contract_address: txReceipt.to, // The contract address
          gas_used: txReceipt.gasUsed,
          related_trade_id: trade_id,
          related_escrow_db_id: escrowDbId, // Link to the DB escrow record
          error_message: null,
          network_id: networkId,
        });

        res.json({
          success: true,
          escrowId: verifiedEscrowId, // The blockchain escrow ID (uint256 as string)
          escrowDbId: escrowDbId, // The database primary key for the escrow record
          txHash: transaction_hash,
          blockNumber: txReceipt.blockNumber,
        });
      } catch (txError) {
        // Attempt to record the FAILED transaction if verification/parsing failed
        await recordTransaction({
          transaction_hash: transaction_hash, // Use the hash we have
          status: 'FAILED',
          type: 'CREATE_ESCROW',
          sender_address: jwtWalletAddress, // Best guess for sender
          receiver_or_contract_address: CONTRACT_ADDRESS,
          related_trade_id: trade_id,
          error_message: (txError as Error).message,
          network_id: networkId,
          // Other fields might be null or unknown here
        });
        logError(`Transaction verification error for hash ${transaction_hash}`, txError as Error);
        res.status(500).json({
          error: (txError as Error).message,
          details: 'Error occurred during transaction verification',
        });
      }
    } catch (err) {
      logError(`Error in /escrows/record endpoint for trade ${trade_id}`, err as Error);
      res.status(500).json({
        error: (err as Error).message,
        details: 'Error occurred while recording escrow',
      });
    }
  })
);

export default router;
