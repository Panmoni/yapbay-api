import express from 'express';
import deadlinesRouter from './deadlines';
import escrowsRouter from './escrows';
import tradesRouter from './trades';

const router = express.Router();

// Mount admin routes
router.use('/trades', tradesRouter);
router.use('/deadline-stats', deadlinesRouter);
router.use('/escrows', escrowsRouter);

export default router;
