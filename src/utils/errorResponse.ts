import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Options for creating an error response
 */
export interface ErrorResponseOptions {
  code: string;
  message: string;
  requestId?: string;
  retryAfter?: number;
  statusCode?: number;
}

/**
 * Standardized error response structure
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: {
      request_id: string;
      timestamp: string;
      path: string;
      method: string;
      retry_after?: number | null;
    };
  };
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(req: Request, options: ErrorResponseOptions): ErrorResponse {
  const { code, message, requestId, retryAfter } = options;

  const finalRequestId = requestId || req.requestId || `req_${randomUUID()}`;

  const details: ErrorResponse['error']['details'] = {
    request_id: finalRequestId,
    timestamp: new Date().toISOString(),
    path: req.originalUrl || req.path || '/',
    method: req.method || 'UNKNOWN',
    ...(retryAfter !== undefined && { retry_after: retryAfter }),
  };

  return {
    error: {
      code,
      message,
      details,
    },
  };
}

/**
 * Send a standardized error response (sets status + sends JSON in one call).
 */
export function sendErrorResponse(
  req: Request,
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  options?: { retryAfter?: number },
): void {
  res.status(statusCode).json(createErrorResponse(req, { code, message, statusCode, ...options }));
}
