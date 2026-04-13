import express from 'express';
import { idempotency } from '../../middleware/idempotency';
import blockchainRouter from './blockchain';
import operationsRouter from './operations';

const router = express.Router();

// Mutating verbs under /escrows (POST/PUT/PATCH/DELETE) MUST carry a valid
// Idempotency-Key. Financial double-write (double-recorded escrow creation)
// is the single worst failure mode here, so the middleware is strict.
// GET requests pass through unaffected — the middleware only gates
// mutating verbs.
router.use(idempotency({ required: true }));

// Mount operations routes
router.use('/', operationsRouter);

// Mount blockchain routes
router.use('/', blockchainRouter);

export default router;
