import express from 'express';
import divviRouter from './divvi';

const router = express.Router();

// Mount Divvi referral routes
router.use('/divvi-referrals', divviRouter);

export default router;