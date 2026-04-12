import express from 'express';
import { idempotency } from '../../middleware/idempotency';
import blockchainRouter from './blockchain';
import operationsRouter from './operations';

const router = express.Router();

router.use(idempotency());

// Mount operations routes
router.use('/', operationsRouter);

// Mount blockchain routes
router.use('/', blockchainRouter);

export default router;
