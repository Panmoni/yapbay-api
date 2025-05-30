import express, { Response } from 'express';
import { query } from '../../db';
import { withErrorHandling } from '../../middleware/errorHandler';
import { logError } from '../../logger';
import { getWalletAddressFromJWT } from '../../utils/jwtUtils';
import { AuthenticatedRequest, restrictToOwner } from '../../middleware';
import { validateAccountCreation, validateAccountUpdate } from './validation';

const router = express.Router();

// Create a new account
router.post(
  '/',
  validateAccountCreation,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { wallet_address, username, email } = req.body;

    const result = await query(
      'INSERT INTO accounts (wallet_address, username, email) VALUES ($1, $2, $3) RETURNING id',
      [wallet_address, username, email]
    );
    res.status(201).json({ id: result[0].id });
  })
);

// Get account details for authenticated user
router.get(
  '/me',
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const walletAddress = getWalletAddressFromJWT(req);
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
  '/:id',
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
          // Explicitly exclude sensitive fields: email, phone_*
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
  '/:id',
  restrictToOwner('account', 'id'),
  validateAccountUpdate,
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

export default router;