import type { Request } from 'express';
import {
  MALICIOUS_PATH_PATTERNS,
  SUSPICIOUS_METHODS,
  SUSPICIOUS_QUERY_PATTERNS,
  SUSPICIOUS_USER_AGENTS,
} from './suspiciousPatterns';

/**
 * Suspicious pattern detection for enhanced security.
 * Identifies requests that may be from automated scanners or attackers.
 *
 * Pattern definitions live in suspiciousPatterns.ts so they can be
 * maintained independently of the detection logic here.
 */

/**
 * Find the first malicious path pattern matching the given path.
 * Handles URL-decoding safely.
 */
function findMaliciousPathPattern(path: string): RegExp | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }

  for (const pattern of MALICIOUS_PATH_PATTERNS) {
    if (pattern.test(path) || pattern.test(decoded)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Check if a path matches malicious patterns
 */
function isMaliciousPath(path: string): boolean {
  return findMaliciousPathPattern(path) !== null;
}

/**
 * Check if query string contains exploit patterns
 */
function isSuspiciousQuery(url: string): boolean {
  for (const pattern of SUSPICIOUS_QUERY_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if user agent is suspicious
 */
function isSuspiciousUserAgent(userAgent: string | undefined): boolean {
  if (!userAgent) {
    return false; // No user agent is not necessarily suspicious
  }

  for (const pattern of SUSPICIOUS_USER_AGENTS) {
    if (pattern.test(userAgent)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a request has suspicious characteristics
 * @param req Express request object
 * @returns true if the request matches suspicious patterns
 */
export function isSuspiciousRequest(req: Request): boolean {
  const path = req.path || req.url;
  const userAgent = req.get('User-Agent');

  // Check for malicious paths
  if (isMaliciousPath(path)) {
    return true;
  }

  // Check for suspicious query strings (use originalUrl to include query params)
  if (req.originalUrl && isSuspiciousQuery(req.originalUrl)) {
    return true;
  }

  // Check for suspicious HTTP methods
  if (SUSPICIOUS_METHODS.has(req.method)) {
    return true;
  }

  // Check for suspicious user agents (only for unauthenticated requests)
  // Authenticated requests with these user agents might be legitimate API clients
  if (!req.headers.authorization && isSuspiciousUserAgent(userAgent)) {
    return true;
  }

  return false;
}

/**
 * Get suspicious pattern details for logging
 */
export function getSuspiciousPatternDetails(req: Request): {
  isSuspicious: boolean;
  reasons: string[];
} {
  const path = req.path || req.url;
  const userAgent = req.get('User-Agent');
  const reasons: string[] = [];

  if (isMaliciousPath(path)) {
    reasons.push('malicious_path');
  }

  if (req.originalUrl && isSuspiciousQuery(req.originalUrl)) {
    reasons.push('suspicious_query');
  }

  if (SUSPICIOUS_METHODS.has(req.method)) {
    reasons.push('suspicious_method');
  }

  if (!req.headers.authorization && isSuspiciousUserAgent(userAgent)) {
    reasons.push('suspicious_user_agent');
  }

  return {
    isSuspicious: reasons.length > 0,
    reasons,
  };
}

/**
 * Identify which specific pattern matched the request.
 * Returns the pattern type and the regex source string for database logging.
 */
export function getMatchedPattern(req: Request): { type: string; pattern: string } | null {
  const path = req.path || req.url;
  const userAgent = req.get('User-Agent');

  const pathPattern = findMaliciousPathPattern(path);
  if (pathPattern) {
    return { type: 'malicious_path', pattern: pathPattern.source };
  }

  if (req.originalUrl) {
    for (const pattern of SUSPICIOUS_QUERY_PATTERNS) {
      if (pattern.test(req.originalUrl)) {
        return { type: 'suspicious_query', pattern: pattern.source };
      }
    }
  }

  if (SUSPICIOUS_METHODS.has(req.method)) {
    return { type: 'suspicious_method', pattern: req.method };
  }

  if (userAgent && !req.headers.authorization) {
    for (const pattern of SUSPICIOUS_USER_AGENTS) {
      if (pattern.test(userAgent)) {
        return { type: 'suspicious_user_agent', pattern: pattern.source };
      }
    }
  }

  return null;
}
