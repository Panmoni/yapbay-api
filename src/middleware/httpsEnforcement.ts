import type { NextFunction, Request, Response } from 'express';
import { sendErrorResponse } from '../utils/errorResponse';

/**
 * HTTPS Enforcement Middleware
 *
 * Enforces HTTPS connections in production/staging environments.
 * In development, HTTP is allowed for local testing.
 *
 * This middleware should be placed after CORS but before routes.
 * It relies on the Express 'trust proxy' setting to correctly detect
 * the protocol when behind a reverse proxy.
 *
 * Environment variable: ENFORCE_HTTPS (default: true in production)
 */
export function enforceHTTPS(req: Request, res: Response, next: NextFunction): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const enforceHttps = process.env.ENFORCE_HTTPS !== 'false'; // Default to true unless explicitly false

  // Always allow OPTIONS requests (CORS preflight) - CORS middleware handles them
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  // Allow HTTP in development or for localhost connections
  const host = req.get('host') || '';
  const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1');

  if (nodeEnv === 'development' || !enforceHttps || isLocalhost) {
    next();
    return;
  }

  // Check protocol - respect X-Forwarded-Proto when behind proxy
  const protocol = req.protocol || req.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http';

  // Reject HTTP requests in production/staging
  if (protocol !== 'https') {
    sendErrorResponse(
      req,
      res,
      403,
      'https_required',
      'HTTPS is required for API access. Please use https:// instead of http://',
    );
    return;
  }

  next();
}
