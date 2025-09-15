import express from 'express';
import publicRouter from './public';
import crudRouter from './crud';
import { requireJWT } from '../../middleware';

const router = express.Router();

// Apply authentication middleware to ALL routes in this router
router.use(requireJWT);

// Mount public routes (now authenticated)
router.use('/', publicRouter);

// Mount authenticated CRUD routes
router.use('/', crudRouter);

export default router;
