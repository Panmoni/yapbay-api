import express from 'express';
import crudRouter from './crud';

const router = express.Router();

// Mount CRUD routes
router.use('/', crudRouter);

export default router;