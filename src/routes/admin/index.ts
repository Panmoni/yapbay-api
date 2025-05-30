import express from 'express';
import tradesRouter from './trades';
import deadlinesRouter from './deadlines';
import escrowsRouter from './escrows';
import referralsRouter from './referrals';

const router = express.Router();

// Mount admin routes
router.use('/trades', tradesRouter);
router.use('/deadline-stats', deadlinesRouter);
router.use('/escrows', escrowsRouter);
router.use('/divvi-referrals', referralsRouter);

export default router;