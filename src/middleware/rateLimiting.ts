import type { NextFunction, Request, Response } from 'express';
import { getClientIp, isTrustedIP } from '../utils/clientIp';
import { createErrorResponse } from '../utils/errorResponse';
import type { AuthenticatedRequest } from './auth';

/**
 * Rate limiting middleware for YapBay API
 * Implements per-user rate limiting with configurable windows and limits
 */

interface RateLimitConfig {
  /** Prefix for the rate limit key to isolate buckets (e.g. 'auth-login', 'auth-refresh') */
  keyPrefix?: string;
  maxRequests: number;
  message?: string;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting
const rateLimitStore = new Map<string, RateLimitEntry>();

// Safety cap: evict all entries if the store grows beyond this size (e.g. rotating-IP botnet)
const MAX_RATE_LIMIT_ENTRIES = 50_000;

// Deterministic cleanup interval (every 60s) instead of probabilistic per-request
const CLEANUP_INTERVAL_MS = 60_000;
setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS).unref();

// Default rate limit configuration
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 500, // 500 requests per minute
  message: 'Rate limit exceeded. Please retry after the specified time.',
};

// Sandbox rate limit (more lenient for testing)
const SANDBOX_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 5000, // 5000 requests per minute
  message: 'Rate limit exceeded. Please retry after the specified time.',
};

/**
 * Get rate limit configuration based on environment
 */
function getRateLimitConfig(): RateLimitConfig {
  const isSandbox = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';
  return isSandbox ? SANDBOX_RATE_LIMIT : DEFAULT_RATE_LIMIT;
}

/**
 * Generate a unique key for rate limiting based on user identity.
 * Uses wallet address (sub) if authenticated, otherwise IP address.
 */
function generateRateLimitKey(req: AuthenticatedRequest, keyPrefix?: string): string {
  // Use wallet address (sub claim) if authenticated
  if (req.user?.sub) {
    return keyPrefix ? `user:${keyPrefix}:${req.user.sub}` : `user:${req.user.sub}`;
  }

  // Use utility function to get real client IP (handles proxy headers)
  const ip = getClientIp(req);
  return keyPrefix ? `ip:${keyPrefix}:${ip}` : `ip:${ip}`;
}

/**
 * Clean up expired rate limit entries
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime <= now) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Rate limiting middleware
 */
export function rateLimit(
  config: Partial<RateLimitConfig> = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const rateLimitConfig = { ...getRateLimitConfig(), ...config };

  return (req: Request, res: Response, next: NextFunction): void => {
    // Trusted IPs (CF_TRUSTED_IPS env var) bypass rate limiting entirely
    const clientIP = getClientIp(req);
    if (isTrustedIP(clientIP)) {
      next();
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const key = generateRateLimitKey(authReq, rateLimitConfig.keyPrefix);
    const now = Date.now();

    // Safety cap: if a rotating-IP botnet fills the store, evict the oldest 20% of entries.
    if (rateLimitStore.size > MAX_RATE_LIMIT_ENTRIES) {
      const evictCount = Math.ceil(rateLimitStore.size * 0.2);
      console.warn(
        `[RateLimit] Store exceeded capacity (${rateLimitStore.size}) — evicting ${evictCount} oldest entries`,
      );
      // Map iteration order is insertion order; oldest entries come first
      let removed = 0;
      for (const k of rateLimitStore.keys()) {
        if (removed >= evictCount) {
          break;
        }
        rateLimitStore.delete(k);
        removed++;
      }
    }

    // Get or create rate limit entry
    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime <= now) {
      // Create new entry or reset expired entry
      entry = {
        count: 0,
        resetTime: now + rateLimitConfig.windowMs,
      };
    }

    // Increment request count
    entry.count++;
    rateLimitStore.set(key, entry);

    // Set rate limit headers
    res.setHeader('X-Rate-Limit-Limit', rateLimitConfig.maxRequests.toString());
    res.setHeader(
      'X-Rate-Limit-Remaining',
      Math.max(0, rateLimitConfig.maxRequests - entry.count).toString(),
    );
    res.setHeader('X-Rate-Limit-Reset', Math.ceil(entry.resetTime / 1000).toString());

    // Check if rate limit exceeded
    if (entry.count > rateLimitConfig.maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('X-Rate-Limit-Retry-After', retryAfter.toString());

      res.status(429).json({
        ...createErrorResponse(req, {
          code: 'rate_limit_exceeded',
          message: rateLimitConfig.message || 'Rate limit exceeded',
          retryAfter,
        }),
        rate_limit: {
          limit: rateLimitConfig.maxRequests,
          remaining: 0,
          reset: Math.ceil(entry.resetTime / 1000),
          retry_after: retryAfter,
        },
      });
      return;
    }

    next();
  };
}

/**
 * Default rate limiting middleware
 */
export const defaultRateLimit = rateLimit();

/**
 * Strict rate limiting for sensitive operations
 */
export const strictRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 50, // 50 requests per minute
  message: 'Rate limit exceeded for sensitive operations. Please retry after the specified time.',
});

/**
 * Lenient rate limiting for public endpoints
 */
export const lenientRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 5000, // 5000 requests per minute
  message: 'Rate limit exceeded. Please retry after the specified time.',
});

/**
 * Suspicious pattern rate limiting
 * Stricter limits for unauthenticated requests with suspicious characteristics
 */
export const suspiciousPatternRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20, // 20 requests per minute for suspicious patterns
  message: 'Rate limit exceeded. Suspicious activity detected.',
});

/**
 * Clear rate limit for a specific IP address
 */
export function clearRateLimitForIp(ip: string): boolean {
  let cleared = false;
  const baseKey = `ip:${ip}`;
  const prefixedSuffix = `:${ip}`;
  for (const key of rateLimitStore.keys()) {
    if (
      key === baseKey ||
      (key.startsWith('ip:') && key.endsWith(prefixedSuffix) && key.split(':').length <= 3)
    ) {
      rateLimitStore.delete(key);
      cleared = true;
    }
  }
  return cleared;
}

/**
 * Clear rate limit for a specific user
 */
export function clearRateLimitForUser(userId: string): boolean {
  let cleared = false;
  const baseKey = `user:${userId}`;
  const prefixedSuffix = `:${userId}`;
  for (const key of rateLimitStore.keys()) {
    if (
      key === baseKey ||
      (key.startsWith('user:') && key.endsWith(prefixedSuffix) && key.split(':').length <= 3)
    ) {
      rateLimitStore.delete(key);
      cleared = true;
    }
  }
  return cleared;
}

/**
 * Clear all rate limit entries
 */
export function clearAllRateLimits(): number {
  const count = rateLimitStore.size;
  rateLimitStore.clear();
  return count;
}

/**
 * Get all current rate limit entries (for debugging/admin purposes)
 */
export function getAllRateLimitEntries(): Array<{ key: string; count: number; resetTime: Date }> {
  const entries: Array<{ key: string; count: number; resetTime: Date }> = [];
  for (const [key, entry] of rateLimitStore.entries()) {
    entries.push({
      key,
      count: entry.count,
      resetTime: new Date(entry.resetTime),
    });
  }
  return entries;
}
