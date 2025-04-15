import express, { Request as ExpressRequest, Response, Router, NextFunction } from 'express';
import { query } from './db';
import { provider, getSigner, getContract, getSignedContract, formatUSDC, parseUSDC } from './celo';
import { requestLogger, logError } from './logger';
import jwt, { JwtPayload } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import axios from 'axios';
import { ethers } from 'ethers';

// Extend Express Request interface
interface Request extends ExpressRequest {
  user?: JwtPayload;
}

// JWT Verification Setup
const client = jwksClient({
  jwksUri: 'https://app.dynamic.xyz/api/v0/sdk/322e23a8-06d7-445f-b525-66426d63d858/.well-known/jwks',
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
  jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
    if (err) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    req.user = decoded as jwt.JwtPayload;
    next();
  });
};

const withErrorHandling = (handler: (req: Request, res: Response) => Promise<void>) => {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      const error = err as Error & { code?: string };
      logError(`Route ${req.method} ${req.path} failed`, error);
      if (error.code === '23505') { // PostgreSQL duplicate key error
        res.status(409).json({ error: 'Resource already exists with that key' });
      } else {
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    }
  };
};

// Helper to get wallet address from JWT
const getWalletAddressFromJWT = (req: Request): string | undefined => {
  const credentials = req.user?.verified_credentials;
  return credentials?.find((cred: any) => cred.format === 'blockchain')?.address;
};

// Middleware to check ownership
const restrictToOwner = (
  resourceType: "account" | "offer",
  resourceKey: string
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const walletAddress = getWalletAddressFromJWT(req);
    if (!walletAddress) {
      res.status(403).json({ error: "No wallet address in token" });
      return;
    }
    const resourceId = req.params.id || req.body[resourceKey];
    try {
      const table = resourceType === "account" ? "accounts" : "offers";
      const column =
        resourceType === "account" ? "wallet_address" : "creator_account_id";
      const result = await query(
        `SELECT ${column} FROM ${table} WHERE id = $1`,
        [resourceId]
      );
      if (result.length === 0) {
        res.status(404).json({ error: `${resourceType} not found` });
        return;
      }
      const ownerField =
        resourceType === "account"
          ? result[0].wallet_address
          : result[0].creator_account_id;
      const accountCheck =
        resourceType === "offer"
          ? await query("SELECT wallet_address FROM accounts WHERE id = $1", [
              ownerField,
            ])
          : [{ wallet_address: ownerField }];
      if (accountCheck[0].wallet_address.toLowerCase() !== walletAddress.toLowerCase()) {
        res
          .status(403)
          .json({
            error: `Unauthorized: You can only manage your own ${resourceType}s`,
          });
        return;
      }
      next();
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  };
};

// PUBLIC ROUTES
// TODO: rate limiting or otherwise locking it down
router.get('/prices', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
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
    const error = err as Error & { response?: { status: number; data: any } };
    logError('Failed to fetch prices', error);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || error.message || 'Failed to fetch prices',
    });
  }
}));

// List offers (publicly accessible but can filter by owner if authenticated)
router.get('/offers', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const { type, token, owner } = req.query;
  try {
    let sql = 'SELECT * FROM offers WHERE 1=1';
    const params: string[] = [];

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
      sql += ' AND creator_account_id IN (SELECT id FROM accounts WHERE wallet_address = $' + (params.length + 1) + ')';
      params.push(walletAddress);
    }

    const result = await query(sql, params);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

// Get offer details (publicly accessible)
router.get('/offers/:id', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const result = await query('SELECT * FROM offers WHERE id = $1', [id]);
    if (result.length === 0) {
      res.status(404).json({ error: 'Offer not found' });
      return;
    }
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

// PRIVATE ROUTES
// PRIVATE ROUTES - Require JWT
router.use(requireJWT);

// Health Check Endpoint (Authenticated)
router.get('/health', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const walletAddress = getWalletAddressFromJWT(req);
  let dbOk = false;
  let celoNetwork: ethers.Network | null = null;
  let celoError: string | null = null;

  try {
    await query('SELECT 1');
    dbOk = true;
  } catch (dbErr) {
    logError('Health check DB query failed', dbErr as Error);
  }

  try {
    celoNetwork = await provider.getNetwork();
  } catch (celoErr) {
    logError('Health check Celo provider failed', celoErr as Error);
    celoError = (celoErr as Error).message;
  }

  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    userWallet: walletAddress || 'Not Found',
    dbStatus: dbOk ? 'Connected' : 'Error',
    celoProviderStatus: celoNetwork ? `Connected (${celoNetwork.name}, ChainID: ${celoNetwork.chainId})` : `Error (${celoError || 'Unknown'})`,
  });
}));

// 1. Accounts Endpoints
// Create a new account
router.post('/accounts', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
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

}));

// Get account details for authenticated user
router.get('/accounts/me', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const walletAddress = getWalletAddressFromJWT(req);
  console.log('Searching for account with wallet:', walletAddress);
  const result = await query(
    'SELECT * FROM accounts WHERE LOWER(wallet_address) = LOWER($1)',
    [walletAddress]
  );
  if (result.length === 0) {
    console.error('No account found for wallet:', walletAddress);
    res.status(404).json({
      error: 'Account not found',
      detail: `No account registered for wallet ${walletAddress}`
    });
    return;
  }
  res.json(result[0]);
}));

// Retrieve account details (publicly accessible)
router.get('/accounts/:id', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const result = await query('SELECT * FROM accounts WHERE id = $1', [id]);
    if (result.length === 0) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

// Update account info (restricted to owner)
router.put('/accounts/:id', restrictToOwner('account', 'id'), withErrorHandling(async (req: Request, res: Response): Promise<void> => {
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
    timezone
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
        id
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
}));

// 2. Offers Endpoints
// Create a new offer (restricted to creator's account)
router.post('/offers', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const { creator_account_id, offer_type, min_amount, fiat_currency = 'USD' } = req.body;
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

  const accountCheck = await query('SELECT wallet_address FROM accounts WHERE id = $1', [creator_account_id]);
  if (accountCheck.length === 0 || accountCheck[0].wallet_address.toLowerCase() !== jwtWalletAddress.toLowerCase()) {
    res.status(403).json({ error: 'Unauthorized: You can only create offers for your own account' });
    return;
  }
  const result = await query(
    'INSERT INTO offers (creator_account_id, offer_type, token, fiat_currency, min_amount, max_amount, total_available_amount, rate_adjustment, terms, escrow_deposit_time_limit, fiat_payment_time_limit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
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
      '30 minutes'
    ]
  );
  res.status(201).json({ id: result[0].id });
}));

// Update an offer (restricted to creator)
router.put('/offers/:id', restrictToOwner('offer', 'id'), withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { min_amount } = req.body;
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
      token
    } = req.body;

    // Format time limits as PostgreSQL interval strings
    const formatTimeLimit = (limit: any) => {
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
      WHERE id = $11 RETURNING id`,
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
        id
      ]
    );
    if (result.length === 0) {
      res.status(404).json({ error: 'Offer not found' });
      return;
    }
    res.json({ id: result[0].id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

// Delete an offer (restricted to creator)
router.delete('/offers/:id', restrictToOwner('offer', 'id'), withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const result = await query('DELETE FROM offers WHERE id = $1 RETURNING id', [id]);
    if (result.length === 0) {
      res.status(404).json({ error: 'Offer not found' });
      return;
    }
    res.json({ message: 'Offer deleted' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

// 3. Trades Endpoints
// Initiate a trade (requires JWT but no ownership check yet—open to any authenticated user)
router.post(
  "/trades",
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
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
    const jwtWalletAddress = getWalletAddressFromJWT(req);
    if (!jwtWalletAddress) {
      res.status(403).json({ error: "No wallet address in token" });
      return;
    }

    const leg1Offer = await query("SELECT * FROM offers WHERE id = $1", [
      leg1_offer_id,
    ]);
    if (leg1Offer.length === 0) {
      res.status(404).json({ error: "Leg 1 offer not found" });
      return;
    }

    if (leg1Offer[0].total_available_amount < leg1Offer[0].min_amount) {
      res.status(400).json({ error: 'Offer no longer available' });
      return;
    }

    const creatorAccount = await query(
      "SELECT id, wallet_address FROM accounts WHERE id = $1",
      [leg1Offer[0].creator_account_id]
    );
    const buyerAccount = await query(
      "SELECT id FROM accounts WHERE wallet_address = $1",
      [jwtWalletAddress]
    );
    if (buyerAccount.length === 0) {
      res.status(403).json({ error: "Buyer account not found" });
      return;
    }

    // Calculate the new total_available_amount
    const amountToSubtract = parseFloat(leg1_crypto_amount || leg1Offer[0].min_amount);
    const newTotalAvailable = parseFloat(leg1Offer[0].total_available_amount) - amountToSubtract;
    const maxAmount = parseFloat(leg1Offer[0].max_amount);
    const minAmount = parseFloat(leg1Offer[0].min_amount);

    // Check if the trade would make the available amount negative
    if (newTotalAvailable < 0) {
      res.status(400).json({ error: 'Insufficient available amount for this trade' });
      return;
    }

    const isSeller = leg1Offer[0].offer_type === "SELL";
    const leg1SellerAccountId = isSeller
      ? creatorAccount[0].id
      : buyerAccount[0].id;
    const leg1BuyerAccountId = isSeller
      ? buyerAccount[0].id
      : creatorAccount[0].id;
    
    // Add check to prevent self-trades
    if (leg1SellerAccountId === leg1BuyerAccountId) {
      res.status(400).json({ error: 'Cannot create a trade with your own offer' });
      return;
    }

    const result = await query(
      `INSERT INTO trades (
      leg1_offer_id, leg2_offer_id, overall_status, from_fiat_currency, destination_fiat_currency, from_bank, destination_bank,
      leg1_state, leg1_seller_account_id, leg1_buyer_account_id, leg1_crypto_token, leg1_crypto_amount, leg1_fiat_currency, leg1_fiat_amount
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [
        leg1_offer_id,
        leg2_offer_id || null,
        "IN_PROGRESS",
        from_fiat_currency || leg1Offer[0].fiat_currency,
        destination_fiat_currency || leg1Offer[0].fiat_currency,
        from_bank || null,
        destination_bank || null,
        "CREATED",
        leg1SellerAccountId,
        leg1BuyerAccountId,
        leg1Offer[0].token,
        leg1_crypto_amount || leg1Offer[0].min_amount,
        leg1Offer[0].fiat_currency,
        leg1_fiat_amount || null,
      ]
    );

    // Check if the new total would violate the constraint
    if (newTotalAvailable < maxAmount) {
      // If new total would be less than min_amount, update all three values
      if (newTotalAvailable < minAmount) {
        await query(
          'UPDATE offers SET total_available_amount = $1, max_amount = $1, min_amount = $1 WHERE id = $2',
          [newTotalAvailable, leg1_offer_id]
        );
      } else {
        // Otherwise just update total_available_amount and max_amount
        await query(
          'UPDATE offers SET total_available_amount = $1, max_amount = $1 WHERE id = $2',
          [newTotalAvailable, leg1_offer_id]
        );
      }
    } else {
      // Just update total_available_amount
      await query(
        'UPDATE offers SET total_available_amount = total_available_amount - $1 WHERE id = $2',
        [amountToSubtract, leg1_offer_id]
      );
    }

    res.status(201).json({ id: result[0].id });
  })
);

// List trades (publicly accessible with filters)
router.get('/trades', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const { status, user } = req.query;
  try {
    let sql = 'SELECT * FROM trades WHERE 1=1';
    const params: string[] = [];
    if (status) {
      sql += ' AND overall_status = $' + (params.length + 1);
      params.push(status as string);
    }
    if (user) {
      sql += ' AND (leg1_offer_id IN (SELECT id FROM offers WHERE creator_account_id = $' + (params.length + 1) + '))';
      params.push(user as string);
    }
    const result = await query(sql, params);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

// List trades for authenticated user
router.get('/my/trades', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const jwtWalletAddress = getWalletAddressFromJWT(req);
  const result = await query(
    'SELECT t.* FROM trades t JOIN accounts a ON t.leg1_seller_account_id = a.id OR t.leg1_buyer_account_id = a.id WHERE a.wallet_address = $1',
    [jwtWalletAddress]
  );
  res.json(result);
}));

// Get trade details (publicly accessible)
router.get('/trades/:id', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const result = await query('SELECT * FROM trades WHERE id = $1', [id]);
    if (result.length === 0) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

// Update trade info (restricted to trade participants)
router.put('/trades/:id', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { leg1_state, overall_status, fiat_paid } = req.body;

  const jwtWalletAddress = getWalletAddressFromJWT(req);
  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }

  const trade = await query('SELECT * FROM trades WHERE id = $1', [id]);
  if (trade.length === 0) {
    res.status(404).json({ error: 'Trade not found' });
    return;
  }

  const sellerWallet = await query('SELECT wallet_address FROM accounts WHERE id = $1', [trade[0].leg1_seller_account_id]);
  const buyerWallet = await query('SELECT wallet_address FROM accounts WHERE id = $1', [trade[0].leg1_buyer_account_id]);
  if (sellerWallet[0].wallet_address.toLowerCase() !== jwtWalletAddress.toLowerCase() && 
      (!buyerWallet[0] || buyerWallet[0].wallet_address.toLowerCase() !== jwtWalletAddress.toLowerCase())) {
    res.status(403).json({ error: 'Unauthorized: Only trade participants can update' });
    return;
  }

  if (fiat_paid) {
    await query('UPDATE trades SET leg1_fiat_paid_at = NOW() WHERE id = $1', [id]);
  }

  const result = await query(
    'UPDATE trades SET leg1_state = COALESCE($1, leg1_state), overall_status = COALESCE($2, overall_status) WHERE id = $3 RETURNING id',
    [leg1_state, overall_status, id]
  );
  res.json({ id: result[0].id });
}));

// 4. Escrows Endpoints
// Create escrow on Celo
router.post('/escrows/create', withErrorHandling(async (req: Request, res: Response): Promise<void> => {
  const { trade_id, buyer, amount, sequential, sequential_escrow_address } = req.body;
  const jwtWalletAddress = getWalletAddressFromJWT(req);
  
  if (!jwtWalletAddress) {
    res.status(403).json({ error: 'No wallet address in token' });
    return;
  }
  
  if (jwtWalletAddress.toLowerCase() !== req.body.seller.toLowerCase()) {
    res.status(403).json({ error: 'Seller must match authenticated user' });
    return;
  }
  
  if (!Number.isInteger(Number(trade_id))) {
    res.status(400).json({ error: 'trade_id must be an integer' });
    return;
  }
  
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  try {
    // Check if buyer is a valid address
    if (!ethers.isAddress(buyer)) {
      res.status(400).json({ error: 'buyer must be a valid Ethereum address' });
      return;
    }

    // Validate sequential parameters
    if (sequential === true && !sequential_escrow_address) {
      res.status(400).json({ error: 'sequential_escrow_address must be provided when sequential is true' });
      return;
    }

    if (sequential_escrow_address && !ethers.isAddress(sequential_escrow_address)) {
      res.status(400).json({ error: 'sequential_escrow_address must be a valid Ethereum address' });
      return;
    }

    const tradeCheck = await query('SELECT id FROM trades WHERE id = $1', [trade_id]);
    if (tradeCheck.length === 0) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }

    // Convert amount to USDC format (6 decimals)
    const amountInUSDC = formatUSDC(amount);
    
    // Get the contract with signer
    const contract = getSignedContract();
    
    try {
      // Create escrow transaction
      const tx = await contract.createEscrow(
        BigInt(trade_id),
        buyer,
        amountInUSDC,
        sequential || false,
        sequential_escrow_address || ethers.ZeroAddress
      );
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      
      // Get the escrow ID from the transaction receipt
      let escrowId: bigint | null = null;
      if (receipt && receipt.logs) {
        for (const log of receipt.logs) {
          try {
            const parsedLog = contract.interface.parseLog({
              topics: log.topics as string[],
              data: log.data
            });
            
            if (parsedLog && parsedLog.name === 'EscrowCreated') {
              escrowId = parsedLog.args.escrowId;
              break;
            }
          } catch (e) {
            // Skip logs that can't be parsed
            continue;
          }
        }
      }
      
      if (!escrowId) {
        throw new Error('Failed to get escrow ID from transaction receipt');
      }
      
      // Update the trade with the escrow address
      const updateResult = await query(
        'UPDATE trades SET leg1_escrow_address = $1 WHERE id = $2 RETURNING id, leg1_escrow_address',
        [req.body.seller, trade_id]
      );
      
      // Insert into escrows table
      await query(
        'INSERT INTO escrows (trade_id, escrow_address, seller_address, buyer_address, arbitrator_address, token_type, amount, state, sequential) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          trade_id,
          req.body.seller,
          req.body.seller,
          buyer,
          process.env.ARBITRATOR_ADDRESS,
          'USDC',
          amount,
          'CREATED',
          sequential || false
        ]
      );
      
      res.json({
        escrowId: escrowId.toString(),
        txHash: receipt?.hash,
        blockNumber: receipt?.blockNumber
      });
    } catch (txError) {
      console.error('Transaction error:', txError);
      res.status(500).json({
        error: (txError as Error).message,
        details: 'Error occurred during contract interaction'
      });
    }
  } catch (err) {
    console.error('Error in /escrows/create:', err);
    const error = err as Error;
    res.status(500).json({
      error: error.message,
      details: 'Error occurred while creating escrow'
    });
  }
}));

export default router;
