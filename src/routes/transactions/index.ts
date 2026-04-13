import express from 'express';
import { idempotency } from '../../middleware/idempotency';
import lookupRouter from './lookup';
import recordRouter from './record';

const router = express.Router();

// Mutating verbs under /transactions MUST carry a valid Idempotency-Key.
// POST /transactions is the hottest replay-vulnerable write path — a
// client retry after a network failure must never create a second ledger
// row. GET requests pass through unaffected.
router.use(idempotency({ required: true }));

// Mount transaction routes
router.use('/', recordRouter);
router.use('/', lookupRouter);

export default router;
