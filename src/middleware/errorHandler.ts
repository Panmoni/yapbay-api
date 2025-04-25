import { Request, Response } from 'express';
import { logError } from '../logger';

/**
 * Wraps an async route handler to catch errors and respond appropriately.
 */
export const withErrorHandling = (handler: (req: Request, res: Response) => Promise<void>) => {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      const error = err as Error & { code?: string };
      logError(`Route ${req.method} ${req.path} failed`, error);
      if (error.code === '23505') {
        // PostgreSQL duplicate key error
        res.status(409).json({ error: 'Resource already exists with that key' });
      } else {
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    }
  };
};
