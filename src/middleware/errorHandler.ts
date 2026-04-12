import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logError } from '../logger';
import { sendErrorResponse, sendValidationError } from '../utils/errorResponse';
import { mapPgError } from '../utils/pgError';

function sendMappedPgError(
  req: Request,
  res: Response,
  mapped: NonNullable<ReturnType<typeof mapPgError>>,
): void {
  if (mapped.retryAfter !== undefined) {
    res.setHeader('Retry-After', String(mapped.retryAfter));
  }
  const body = {
    error: {
      code: mapped.code,
      message: mapped.message,
      details: {
        request_id: req.requestId ?? 'unknown',
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.path || '/',
        method: req.method || 'UNKNOWN',
        ...(mapped.retryAfter !== undefined && { retry_after: mapped.retryAfter }),
      },
      ...(mapped.fields && { fields: mapped.fields }),
    },
  };
  res.status(mapped.status).json(body);
}

/**
 * Wraps an async route handler to catch errors and respond appropriately.
 */
export const withErrorHandling = (handler: (req: Request, res: Response) => Promise<void>) => {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      logError(`Route ${req.method} ${req.path} failed`, err);
      const mapped = mapPgError(err);
      if (mapped) {
        sendMappedPgError(req, res, mapped);
        return;
      }
      const error = err as Error;
      sendErrorResponse(req, res, 500, 'internal_error', error.message || 'Internal server error');
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

  logError(`Unhandled error in ${req.method} ${req.originalUrl}`, err);

  const mapped = mapPgError(err);
  if (mapped) {
    sendMappedPgError(req, res, mapped);
    return;
  }

  const error = err as Error;
  sendErrorResponse(req, res, 500, 'internal_error', error.message || 'Internal server error');
}
