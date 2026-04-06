import type { Request } from 'express';

/**
 * Trusted IPs that are exempt from suspicious pattern detection and rate limiting.
 * Loaded once from CF_TRUSTED_IPS env var (comma-separated).
 * These are IPs that make legitimate automated requests (e.g. the server itself, monitoring).
 */
let trustedIPsCache: Set<string> | null = null;

function getTrustedIPs(): Set<string> {
  if (!trustedIPsCache) {
    const raw = process.env.CF_TRUSTED_IPS || '';
    trustedIPsCache = new Set(
      raw
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean),
    );
  }
  return trustedIPsCache;
}

/**
 * Check if an IP is in the trusted list (CF_TRUSTED_IPS env var).
 * Trusted IPs are exempt from suspicious pattern detection and rate limiting.
 */
export function isTrustedIP(ip: string): boolean {
  return getTrustedIPs().has(ip);
}

/**
 * Returns true if the IP is private or localhost (RFC 1918, loopback, IPv6 link-local).
 * Used to reject header-derived IPs that could be spoofed (X-Forwarded-For, X-Real-IP).
 */
function isPrivateOrLocalhost(ip: string): boolean {
  const t = ip?.trim();
  if (!t) {
    return false;
  }
  if (t === '127.0.0.1' || t === '::1' || t.toLowerCase() === '::ffff:127.0.0.1') {
    return true;
  }
  const parts = t.split('.');
  if (parts.length === 4) {
    const p0 = parts[0];
    const p1 = parts[1];
    if (p0 === undefined || p1 === undefined) {
      return false;
    }
    const a = Number.parseInt(p0, 10);
    const b = Number.parseInt(p1, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) {
      return false;
    }
    if (a === 10) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
  }
  if (t.toLowerCase().startsWith('fe80:')) {
    return true;
  }
  return false;
}

/** Cached result of CF_BEHIND env check (read once per process). */
let cfBehindCache: boolean | null = null;

function isBehindCloudflare(): boolean {
  if (cfBehindCache === null) {
    cfBehindCache = process.env.CF_BEHIND === 'true';
  }
  return cfBehindCache;
}

/** Log once that CF-Connecting-IP was ignored (possible misconfiguration). */
let cfHeaderIgnoredWarned = false;

function logCFHeaderIgnored(): void {
  if (!cfHeaderIgnoredWarned) {
    console.warn(
      'CF-Connecting-IP header present but CF_BEHIND is not "true" — ignoring. Set CF_BEHIND=true if this app runs behind Cloudflare.',
    );
    cfHeaderIgnoredWarned = true;
  }
}

/**
 * Extract the real client IP address from a request.
 *
 * Priority order:
 * 1. CF-Connecting-IP (Cloudflare) - only trusted when CF_BEHIND=true
 * 2. req.ip (Express 'trust proxy' mode) when not private/localhost
 * 3. X-Forwarded-For (first IP) - only if not private/localhost (spoofable)
 * 4. X-Real-IP - only if not private/localhost (spoofable)
 * 5. Socket remote address (unspoofable)
 *
 * @param req Express request object
 * @returns The client IP address, or 'unknown' if none can be determined
 */
export function getClientIp(req: Request): string {
  // Priority 1: Cloudflare's CF-Connecting-IP — only trusted when CF_BEHIND=true
  const cloudflareIP = req.get('CF-Connecting-IP')?.trim();
  if (cloudflareIP) {
    if (isBehindCloudflare()) {
      return cloudflareIP;
    }
    logCFHeaderIgnored();
  }

  // Priority 2: req.ip (from Express; with trust proxy this is from X-Forwarded-For)
  // Do not trust private/localhost so we don't trust a spoofed header
  if (req.ip && req.ip !== '::1' && req.ip !== '127.0.0.1' && !isPrivateOrLocalhost(req.ip)) {
    return req.ip;
  }

  // Priority 3: X-Forwarded-For (first IP) - do not trust if private/localhost (spoofable)
  const forwardedFor = req.get('X-Forwarded-For');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp && !isPrivateOrLocalhost(firstIp)) {
      return firstIp;
    }
  }

  // Priority 4: X-Real-IP - do not trust if private/localhost (spoofable)
  const realIp = req.get('X-Real-IP')?.trim();
  if (realIp && !isPrivateOrLocalhost(realIp)) {
    return realIp;
  }

  // Priority 5: Socket remote address (unspoofable)
  if (req.socket?.remoteAddress) {
    return req.socket.remoteAddress;
  }

  return 'unknown';
}
