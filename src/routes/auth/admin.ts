import express, { Response } from 'express';
import bcrypt from 'bcrypt';
import { withErrorHandling } from '../../middleware/errorHandler';
import { signJwt, CustomJwtPayload } from '../../utils/jwtUtils';
import { AuthenticatedRequest } from '../../middleware/auth';

const router = express.Router();

// TODO: Migrate admin credentials to a secure admin user table, add MFA, rate-limiting, and proper audit logging instead of env-based auth.
// /login
router.post(
  '/login',
  withErrorHandling(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

export default router;