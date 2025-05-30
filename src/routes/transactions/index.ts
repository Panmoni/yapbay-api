import express from 'express';
import recordRouter from './record';
import lookupRouter from './lookup';

const router = express.Router();

// Mount transaction routes
router.use('/', recordRouter);
router.use('/', lookupRouter);

export default router;