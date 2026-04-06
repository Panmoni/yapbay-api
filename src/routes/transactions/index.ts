import express from 'express';
import lookupRouter from './lookup';
import recordRouter from './record';

const router = express.Router();

// Mount transaction routes
router.use('/', recordRouter);
router.use('/', lookupRouter);

export default router;
