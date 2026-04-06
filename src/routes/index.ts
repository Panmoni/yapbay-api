import express from 'express';
import { requestLogger } from '../logger';
import { requireAdmin, requireJWT } from '../middleware';
import accountsRouter from './accounts';
import adminRouter from './admin';
import authRouter from './auth';
import escrowsRouter from './escrows';
import healthRouter from './health';
import offersRouter from './offers';
// Import modular routes
import publicRouter from './public';
import tradesRouter from './trades';
import transactionRouter from './transactions';

const router = express.Router();

// Logger must be first middleware to catch all requests
router.use((req, res, next) => {
  try {
    requestLogger(req, res, next);
  } catch (err) {
    console.error('Logger failed:', err);
    next();
  }
});

// Mount public routes (no authentication required)
router.use('/', publicRouter);

// Mount health check routes (public)
router.use('/health', healthRouter);

// Mount offers routes (public)
router.use('/offers', offersRouter);

// Mount authentication routes
router.use('/', authRouter);

// Apply JWT middleware to all subsequent routes
router.use(requireJWT);

// Mount domain-specific routes (all authenticated)
router.use('/accounts', accountsRouter);
router.use('/trades', tradesRouter);
router.use('/escrows', escrowsRouter);

// Mount existing admin and transaction routes (authenticated)
router.use('/admin', requireAdmin, adminRouter);
router.use('/transactions', transactionRouter);

export default router;
