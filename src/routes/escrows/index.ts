import express from 'express';
import blockchainRouter from './blockchain';
import operationsRouter from './operations';

const router = express.Router();

// Mount operations routes
router.use('/', operationsRouter);

// Mount blockchain routes
router.use('/', blockchainRouter);

export default router;
