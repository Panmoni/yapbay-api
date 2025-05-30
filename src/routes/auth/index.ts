import express from 'express';
import adminRouter from './admin';

const router = express.Router();

// Mount admin routes
router.use('/admin', adminRouter);

export default router;