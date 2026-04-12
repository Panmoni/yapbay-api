import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { ZodError, ZodIssue } from 'zod';

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
 * A single validation issue produced by a Zod parse failure.
 *
 * `path` is dotted, prefixed with the validation target so clients know
 * whether the issue is in the body, query, params, or headers — e.g.
 * `body.amount`, `query.limit`, `params.id`.
 */
export interface ValidationIssue {
  code: string;
  expected?: string;
  message: string;
  path: string;
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
    /** Present when `code === 'validation_error'` or `'response_validation_error'`. */
    issues?: ValidationIssue[];
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

/**
 * Convert Zod issues to validation issues, prefixing every path with the
 * target name (`body`, `query`, `params`, or `headers`).
 */
export function zodIssuesToValidationIssues(
  target: string,
  issues: readonly ZodIssue[],
): ValidationIssue[] {
  return issues.map((issue) => {
    const path = [target, ...issue.path.map((p) => String(p))].join('.');
    const out: ValidationIssue = {
      code: issue.code,
      message: issue.message,
      path,
    };
    if ('expected' in issue && issue.expected !== undefined) {
      out.expected = String(issue.expected);
    }
    return out;
  });
}

/**
 * Send a 400 validation_error response from a Zod parse failure on
 * `req[target]`. Used by the `validate()` middleware.
 */
export function sendValidationError(
  req: Request,
  res: Response,
  target: 'body' | 'query' | 'params' | 'headers',
  err: ZodError,
): void {
  const issues = zodIssuesToValidationIssues(target, err.issues);
  res.status(400).json({
    error: {
      code: 'validation_error',
      message: `Invalid request ${target}`,
      details: {
        request_id: req.requestId ?? `req_${randomUUID()}`,
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.path || '/',
        method: req.method || 'UNKNOWN',
      },
      issues,
    },
  });
}

/**
 * Send a 500 response_validation_error response when an outgoing response
 * fails its declared response schema. Used by the `validateResponse()`
 * middleware as a last-line safety net against schema drift.
 *
 * The response body is NOT sent to the client (it would be the malformed
 * data); the client gets a generic error and the issues are logged.
 */
export function sendResponseValidationError(req: Request, res: Response, err: ZodError): void {
  const issues = zodIssuesToValidationIssues('response', err.issues);
  res.status(500).json({
    error: {
      code: 'response_validation_error',
      message: 'Server response failed validation',
      details: {
        request_id: req.requestId ?? `req_${randomUUID()}`,
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.path || '/',
        method: req.method || 'UNKNOWN',
      },
      issues,
    },
  });
}
