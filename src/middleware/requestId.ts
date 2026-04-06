import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Request ID middleware.
 * Assigns a unique correlation ID to every inbound request.
 *
 * Priority:
 *   1. Incoming X-Request-Id header (forwarded from upstream proxy/client)
 *   2. Generated UUID v4
 *
 * The ID is stored on req.requestId and returned as the X-Request-Id response header.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
