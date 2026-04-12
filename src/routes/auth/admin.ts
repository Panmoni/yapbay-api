import bcrypt from 'bcrypt';
import express, { type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { withErrorHandling } from '../../middleware/errorHandler';
import { handler } from '../../middleware/typedHandler';
import { validate } from '../../middleware/validate';
import { validateResponse } from '../../middleware/validateResponse';
import { adminLoginRequestSchema, adminLoginResponseSchema } from '../../schemas/admin';
import { type CustomJwtPayload, signJwt } from '../../utils/jwtUtils';

const router = express.Router();

// Rate limit admin login: 5 attempts per 15 minutes per IP
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSchemas = { body: adminLoginRequestSchema } as const;

// /login
router.post(
  '/login',
  adminLoginLimiter,
  validate({ body: adminLoginRequestSchema }),
  validateResponse(adminLoginResponseSchema),
  withErrorHandling(
    handler(loginSchemas, async (req, res: Response): Promise<void> => {
      const { username, password } = req.body;
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
    }),
  ),
);

export default router;
