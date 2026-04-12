import express from 'express';
import { idempotency } from '../../middleware/idempotency';
import lookupRouter from './lookup';
import recordRouter from './record';

const router = express.Router();

// Idempotency applies to mutating verbs only (filtered inside middleware).
// Currently permissive — key is honored when present, not required, to keep
// existing clients working. Flip to `{ required: true }` once rolled out.
router.use(idempotency());

// Mount transaction routes
router.use('/', recordRouter);
router.use('/', lookupRouter);

export default router;
