/**
 * In-Memory IP Blocklist
 *
 * Provides instant rejection of banned IPs without waiting for Cloudflare
 * edge propagation. Populated when bans are created; checked in the
 * suspicious pattern middleware before routing.
 *
 * This is a best-effort, ephemeral cache — it does NOT survive restarts.
 * Cloudflare remains the authoritative blocking layer.
 */

/** Individual blocked IPs (normalised, no CIDR suffix) */
const blockedIPs = new Set<string>();

/** Blocked /24 subnets stored as "a.b.c" prefix strings */
const blockedSubnets = new Set<string>();

/** Safety cap — prevent unbounded memory growth */
const MAX_IPS = 100_000;
const MAX_SUBNETS = 10_000;

/** Strip CIDR suffix from an IP string */
const CIDR_SUFFIX_RE = /\/\d+$/;

/** IPv6-mapped IPv4 prefix (e.g. ::ffff:192.168.1.1) */
const IPV6_MAPPED_PREFIX_RE = /^::ffff:/i;

/** Validate that each octet is 1-3 digits */
const OCTET_RE = /^\d{1,3}$/;

/** Evict oldest 10% of entries from a Set when at capacity */
function evictOldest(set: Set<string>, label: string): void {
  const evictCount = Math.ceil(set.size * 0.1);
  let removed = 0;
  for (const key of set) {
    if (removed >= evictCount) {
      break;
    }
    set.delete(key);
    removed++;
  }
  console.warn(`[Blocklist] ${label} at capacity — evicted ${removed} oldest entries`);
}

// ── helpers ──────────────────────────────────────────────────────────────

function normalizeIP(ip: string): string {
  return ip.replace(IPV6_MAPPED_PREFIX_RE, '').replace(CIDR_SUFFIX_RE, '').trim();
}

/**
 * Returns true if the normalised IP is a valid IPv4 address (4 dot-separated octets).
 * Subnet operations only apply to IPv4; IPv6 is handled by individual IP bans only.
 */
function isIPv4Internal(ip: string): boolean {
  const parts = normalizeIP(ip).split('.');
  return parts.length === 4 && parts.every((p) => OCTET_RE.test(p));
}

function getSubnet24Prefix(ip: string): string | null {
  const normalized = normalizeIP(ip);
  const parts = normalized.split('.');
  if (parts.length !== 4) {
    return null;
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

// ── public API ───────────────────────────────────────────────────────────

export function blockIP(ip: string): void {
  if (blockedIPs.size >= MAX_IPS) {
    evictOldest(blockedIPs, 'IP blocklist');
  }
  blockedIPs.add(normalizeIP(ip));
}

export function blockSubnet24(ip: string): void {
  if (!isIPv4Internal(ip)) {
    return; // Subnet operations only apply to IPv4
  }
  const prefix = getSubnet24Prefix(ip);
  if (!prefix) {
    return;
  }
  if (blockedSubnets.size >= MAX_SUBNETS) {
    evictOldest(blockedSubnets, 'Subnet blocklist');
  }
  blockedSubnets.add(prefix);
  console.info(`[Blocklist] Subnet ${prefix}.0/24 added to in-memory blocklist`);
}

export function isBlocked(ip: string): boolean {
  const normalized = normalizeIP(ip);
  if (blockedIPs.has(normalized)) {
    return true;
  }
  const prefix = getSubnet24Prefix(normalized);
  return prefix !== null && blockedSubnets.has(prefix);
}

export function isIPv4(ip: string): boolean {
  return isIPv4Internal(ip);
}

export function getStats(): { blocked_ips: number; blocked_subnets: number } {
  return { blocked_ips: blockedIPs.size, blocked_subnets: blockedSubnets.size };
}
