import express from 'express';
import { requireJWT } from '../../middleware';
import crudRouter from './crud';
import publicRouter from './public';

const router = express.Router();

// Mount public routes (no authentication required)
router.use('/', publicRouter);

// Apply authentication middleware to CRUD routes only
router.use('/', requireJWT, crudRouter);

export default router;
