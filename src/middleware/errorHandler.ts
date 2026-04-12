import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logError } from '../logger';
import { sendErrorResponse, sendValidationError } from '../utils/errorResponse';

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

/**
 * Express 4-arg error middleware. Catches errors that escape route handlers
 * and `validate()` middleware, including stray `ZodError`s thrown from
 * services or inline parses.
 *
 * MUST be registered at the bottom of the middleware stack in `server.ts`,
 * after all routes.
 *
 * - `ZodError` → 400 validation_error (treated as a body validation failure)
 * - everything else → 500 internal_error (response shape from errorResponse.ts)
 */
export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 4th arg required by Express to recognize this as an error handler
  _next: NextFunction,
): void {
  if (res.headersSent) {
    // Response already started — Express default behavior is to close the
    // socket. Nothing useful we can do here.
    return;
  }

  if (err instanceof ZodError) {
    logError(`Stray ZodError in ${req.method} ${req.originalUrl}`, err);
    sendValidationError(req, res, 'body', err);
    return;
  }

  const error = err as Error & { code?: string };
  logError(`Unhandled error in ${req.method} ${req.originalUrl}`, error);
  sendErrorResponse(req, res, 500, 'internal_error', error.message || 'Internal server error');
}
