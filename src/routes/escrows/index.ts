import express from 'express';
import operationsRouter from './operations';
import blockchainRouter from './blockchain';

const router = express.Router();

// Mount operations routes
router.use('/', operationsRouter);

// Mount blockchain routes  
router.use('/', blockchainRouter);

export default router;