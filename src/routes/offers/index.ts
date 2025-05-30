import express from 'express';
import publicRouter from './public';
import crudRouter from './crud';
import { requireJWT } from '../../middleware';

const router = express.Router();

// Mount public routes (no authentication required)
router.use('/', publicRouter);

// Apply authentication middleware for all subsequent routes
router.use(requireJWT);

// Mount authenticated CRUD routes
router.use('/', crudRouter);

export default router;