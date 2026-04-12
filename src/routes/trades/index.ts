import express from 'express';
import { idempotency } from '../../middleware/idempotency';
import crudRouter from './crud';

const router = express.Router();

router.use(idempotency());

// Mount CRUD routes
router.use('/', crudRouter);

export default router;
