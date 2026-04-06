/**
 * Cloudflare IP Ban Database Service
 *
 * Handles all database operations for IP ban tracking
 * and suspicious activity logging.
 */

import pool from '../../db';
import type {
  CloudflareIPBan,
  CreateBanData,
  SuspiciousActivityRecord,
} from '../../types/cloudflare';

/**
 * Check if an IP is currently banned (active, not yet unbanned)
 */
export async function isIPBanned(ip: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM cloudflare_ip_bans WHERE ip_address = $1 AND unbanned_at IS NULL LIMIT 1',
    [ip],
  );
  return result.rows.length > 0;
}

/**
 * Get an active ban record by IP
 */
export async function getActiveBanByIP(ip: string): Promise<CloudflareIPBan | null> {
  const result = await pool.query(
    'SELECT * FROM cloudflare_ip_bans WHERE ip_address = $1 AND unbanned_at IS NULL LIMIT 1',
    [ip],
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Create a new ban record
 */
export async function createBan(data: CreateBanData): Promise<CloudflareIPBan> {
  const result = await pool.query(
    `INSERT INTO cloudflare_ip_bans (ip_address, ban_reason, pattern_matched, request_path, user_agent, expires_at, banned_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
       ON CONFLICT (ip_address) DO UPDATE SET
         ban_reason = EXCLUDED.ban_reason,
         pattern_matched = EXCLUDED.pattern_matched,
         request_path = EXCLUDED.request_path,
         user_agent = EXCLUDED.user_agent,
         expires_at = EXCLUDED.expires_at,
         unbanned_at = NULL,
         unban_reason = NULL,
         cloudflare_rule_id = NULL,
         api_success = FALSE,
         api_error_message = NULL,
         updated_at = NOW()
       RETURNING *`,
    [
      data.ip_address,
      data.ban_reason,
      data.pattern_matched,
      data.request_path,
      data.user_agent,
      data.expires_at,
    ],
  );
  return result.rows[0];
}

/**
 * Update a ban record with the Cloudflare API result
 */
export async function updateBanWithApiResult(
  id: string,
  cloudflareRuleId: string | null,
  apiSuccess: boolean,
  apiErrorMessage?: string,
): Promise<void> {
  await pool.query(
    `UPDATE cloudflare_ip_bans
       SET cloudflare_rule_id = $2, api_success = $3, api_error_message = $4, updated_at = NOW()
       WHERE id = $1`,
    [id, cloudflareRuleId, apiSuccess, apiErrorMessage || null],
  );
}

/**
 * Mark a ban as unbanned
 */
export async function markUnbanned(id: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE cloudflare_ip_bans
       SET unbanned_at = NOW(), unban_reason = $2, cloudflare_rule_id = NULL, updated_at = NOW()
       WHERE id = $1`,
    [id, reason],
  );
}

/**
 * Get an active ban by IP that failed at the Cloudflare API (for retry)
 */
export async function getFailedBanByIP(ip: string): Promise<CloudflareIPBan | null> {
  const result = await pool.query(
    `SELECT * FROM cloudflare_ip_bans
       WHERE ip_address = $1 AND unbanned_at IS NULL AND api_success = FALSE
       LIMIT 1`,
    [ip],
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Get all active bans that failed at the Cloudflare API (for periodic retry)
 */
export async function getFailedBans(limit = 50): Promise<CloudflareIPBan[]> {
  const result = await pool.query(
    `SELECT * FROM cloudflare_ip_bans
       WHERE unbanned_at IS NULL AND api_success = FALSE
       ORDER BY created_at ASC
       LIMIT $1`,
    [limit],
  );
  return result.rows;
}

/**
 * Delete suspicious activity log entries older than the given number of days.
 * Returns the count of deleted rows.
 */
export async function cleanupSuspiciousActivityLog(retentionDays = 30): Promise<number> {
  const result = await pool.query(
    `DELETE FROM suspicious_activity_log WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
    [retentionDays],
  );
  return result.rowCount ?? 0;
}

/**
 * Log a suspicious activity event
 */
export async function logSuspiciousActivity(data: SuspiciousActivityRecord): Promise<void> {
  await pool.query(
    `INSERT INTO suspicious_activity_log
       (ip_address, pattern_type, pattern_matched, request_path, request_method, user_agent, ban_attempted, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      data.ip_address,
      data.pattern_type,
      data.pattern_matched,
      data.request_path,
      data.request_method,
      data.user_agent,
      data.ban_attempted,
    ],
  );
}
