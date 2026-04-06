/**
 * Cloudflare IP Ban Service
 *
 * Orchestrates banning/unbanning IPs via the Cloudflare API
 * with database tracking. Called from the suspicious pattern
 * middleware in a fire-and-forget pattern.
 */

import pool from '../../db';
import { CloudflareAPIService } from './cloudflareAPIService';
import {
  createBan,
  getActiveBanByIP,
  getFailedBanByIP,
  getFailedBans,
  isIPBanned,
  logSuspiciousActivity,
  markUnbanned,
  updateBanWithApiResult,
} from './cloudflareIPBanDatabaseService';
import { blockIP, blockSubnet24, isIPv4 } from './inMemoryBlocklist';

const BAN_EXPIRY_DAYS = Number.parseInt(process.env.CF_BAN_EXPIRY_DAYS || '180', 10);

/** Minimum distinct banned IPs in a /24 before auto-escalating to a subnet ban */
const SUBNET_ESCALATION_THRESHOLD = Number.parseInt(
  process.env.CF_SUBNET_ESCALATION_THRESHOLD || '2',
  10,
);

/** Strip CIDR suffix from an IP string */
const CIDR_SUFFIX_RE = /\/\d+$/;

export const CloudflareIPBanService = {
  /**
   * Process a suspicious request — log activity and attempt ban.
   * This is the main entry point called from the middleware.
   * All errors are caught and logged; this method never throws.
   */
  async processSuspiciousRequest(
    ip: string,
    patternType: string,
    patternMatched: string,
    requestPath: string,
    requestMethod: string,
    userAgent: string,
  ): Promise<void> {
    const enabled = process.env.CF_BAN_ENABLED === 'true';

    // Always log suspicious activity to database
    let banAttempted = false;

    try {
      // Check if already banned — skip ban attempt but still log
      const alreadyBanned = await isIPBanned(ip);

      if (!alreadyBanned && enabled) {
        banAttempted = true;

        // Immediately block in memory — closes the Cloudflare propagation gap
        blockIP(ip);

        // Create ban record in database
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + BAN_EXPIRY_DAYS);

        const banRecord = await createBan({
          ip_address: ip,
          ban_reason: patternType,
          pattern_matched: patternMatched,
          request_path: requestPath,
          user_agent: userAgent,
          expires_at: expiresAt,
        });

        // Call Cloudflare API
        const notes = `YapBay API auto-ban: ${patternType} — ${patternMatched}`;
        const cfResponse = await CloudflareAPIService.createAccessRule(ip, notes);

        // Update database with API result
        if (cfResponse.success && cfResponse.result) {
          await updateBanWithApiResult(banRecord.id, cfResponse.result.id, true);
          console.info(`[Security] Banned IP ${ip}: ${patternType} — ${patternMatched}`);
        } else {
          const errorMsg = cfResponse.errors?.map((e) => e.message).join(', ') || 'Unknown error';
          await updateBanWithApiResult(banRecord.id, null, false, errorMsg);
          console.error(`[Security] Failed to ban IP ${ip}: ${errorMsg}`);
        }

        // Check if the /24 subnet should be escalated to a full range ban
        await this.maybeEscalateSubnet(ip, patternType);
      } else if (alreadyBanned) {
        // Ensure in-memory blocklist is populated (covers restarts)
        blockIP(ip);

        // Retry if previous Cloudflare API call failed (ban exists in DB but not at edge)
        if (enabled) {
          const failedBan = await getFailedBanByIP(ip);
          if (failedBan) {
            const notes = `YapBay API auto-ban retry: ${failedBan.ban_reason} — ${failedBan.pattern_matched}`;
            const isSubnet = failedBan.ip_address.includes('/');
            const cfResponse = await CloudflareAPIService.createAccessRule(
              failedBan.ip_address,
              notes,
              isSubnet ? 'ip_range' : 'ip',
            );
            if (cfResponse.success && cfResponse.result) {
              await updateBanWithApiResult(failedBan.id, cfResponse.result.id, true);
              console.info(`[Security] Retried and banned IP ${ip}`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[Security] Error processing ban for ${ip}:`, error);
    }

    // Log to suspicious activity table (separate try/catch so logging doesn't fail with ban)
    try {
      await logSuspiciousActivity({
        ip_address: ip,
        pattern_type: patternType,
        pattern_matched: patternMatched,
        request_path: requestPath,
        request_method: requestMethod,
        user_agent: userAgent,
        ban_attempted: banAttempted,
      });
    } catch (error) {
      console.error(`[Security] Failed to log suspicious activity for ${ip}:`, error);
    }
  },

  /**
   * Unban an IP — remove from Cloudflare and mark as unbanned in database
   */
  async unbanIP(ip: string, reason: string): Promise<{ success: boolean; message: string }> {
    const ban = await getActiveBanByIP(ip);

    if (!ban) {
      return { success: false, message: `No active ban found for ${ip}` };
    }

    // Delete from Cloudflare if we have a rule ID
    if (ban.cloudflare_rule_id) {
      const cfResponse = await CloudflareAPIService.deleteAccessRule(ban.cloudflare_rule_id);
      if (!cfResponse.success) {
        const errorMsg = cfResponse.errors?.map((e) => e.message).join(', ') || 'Unknown error';
        console.error(`[Security] Failed to remove CF rule for ${ip}: ${errorMsg}`);
        // Continue with database update even if CF delete fails
      }
    }

    await markUnbanned(ban.id, reason);
    console.info(`[Security] Unbanned IP ${ip}: ${reason}`);

    return { success: true, message: `Unbanned ${ip}` };
  },

  /**
   * Escalate to a /24 subnet ban if multiple IPs from the same range have been banned.
   * Called after each individual IP ban. All errors caught — never throws.
   */
  async maybeEscalateSubnet(ip: string, triggerPatternType: string): Promise<void> {
    // Subnet escalation only applies to IPv4; skip for IPv6
    if (!isIPv4(ip)) {
      return;
    }

    const parts = ip.replace(CIDR_SUFFIX_RE, '').split('.');
    const cidr = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;

    // Use a transaction with an advisory lock keyed on the /24 CIDR to prevent
    // concurrent escalation attempts from creating duplicate Cloudflare rules.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Advisory lock scoped to this transaction — serialises per /24
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [cidr]);

      // Re-check inside the lock — another thread may have already escalated
      const subnetCheck = await client.query(
        `SELECT 1 FROM cloudflare_ip_bans
         WHERE ip_address = $1::inet AND unbanned_at IS NULL LIMIT 1`,
        [cidr],
      );
      if (subnetCheck.rows.length > 0) {
        await client.query('COMMIT');
        return;
      }

      // Count other banned IPs in the same /24 (excludes the current IP)
      const countResult = await client.query(
        `SELECT COUNT(DISTINCT ip_address)::int AS count
         FROM cloudflare_ip_bans
         WHERE ip_address << set_masklen($1::inet, 24)
           AND ip_address != $1::inet
           AND unbanned_at IS NULL`,
        [ip],
      );
      const siblingCount = countResult.rows[0]?.count ?? 0;
      if (siblingCount < SUBNET_ESCALATION_THRESHOLD) {
        await client.query('COMMIT');
        return;
      }

      // Insert subnet ban record inside the transaction
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + BAN_EXPIRY_DAYS);

      const insertResult = await client.query(
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
          cidr,
          'subnet_escalation',
          `${siblingCount + 1} IPs banned from /24 (trigger: ${triggerPatternType})`,
          'auto-escalation',
          'system',
          expiresAt,
        ],
      );

      await client.query('COMMIT');

      const banRecord = insertResult.rows[0];

      // Block in memory immediately (outside transaction — best-effort)
      blockSubnet24(ip);

      // Call Cloudflare API outside the transaction (no need to hold the lock)
      const notes = `YapBay API auto-subnet-ban: ${siblingCount + 1} IPs from ${cidr} banned`;
      const cfResponse = await CloudflareAPIService.createAccessRule(cidr, notes, 'ip_range');

      if (cfResponse.success && cfResponse.result) {
        await updateBanWithApiResult(banRecord.id, cfResponse.result.id, true);
        console.info(
          `[Security] Escalated to subnet ban: ${cidr} (${siblingCount + 1} IPs banned)`,
        );
      } else {
        const errorMsg = cfResponse.errors?.map((e) => e.message).join(', ') || 'Unknown error';
        await updateBanWithApiResult(banRecord.id, null, false, errorMsg);
        console.error(`[Security] Failed to ban subnet ${cidr}: ${errorMsg}`);
      }
    } catch (error) {
      await client.query('ROLLBACK').catch((rollbackErr) => {
        console.error('[Security] Failed to rollback subnet escalation transaction:', rollbackErr);
      });
      console.error(`[Security] Error during subnet escalation for ${ip} (${cidr}):`, error);
    } finally {
      client.release();
    }
  },

  /**
   * Manually ban an IP (from admin endpoint)
   */
  async manualBan(ip: string, reason: string): Promise<{ success: boolean; message: string }> {
    const enabled = process.env.CF_BAN_ENABLED === 'true';

    if (!enabled) {
      return { success: false, message: 'Cloudflare banning is disabled (CF_BAN_ENABLED != true)' };
    }

    const alreadyBanned = await isIPBanned(ip);
    if (alreadyBanned) {
      return { success: false, message: `IP ${ip} is already banned` };
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + BAN_EXPIRY_DAYS);

    const banRecord = await createBan({
      ip_address: ip,
      ban_reason: 'manual',
      pattern_matched: reason,
      request_path: 'admin',
      user_agent: 'admin',
      expires_at: expiresAt,
    });

    const notes = `YapBay API manual ban: ${reason}`;
    const cfResponse = await CloudflareAPIService.createAccessRule(ip, notes);

    if (cfResponse.success && cfResponse.result) {
      await updateBanWithApiResult(banRecord.id, cfResponse.result.id, true);
      return { success: true, message: `Banned ${ip} (rule: ${cfResponse.result.id})` };
    }

    const errorMsg = cfResponse.errors?.map((e) => e.message).join(', ') || 'Unknown error';
    await updateBanWithApiResult(banRecord.id, null, false, errorMsg);
    return { success: false, message: `Failed to ban ${ip}: ${errorMsg}` };
  },

  /**
   * Retry all bans that failed at the Cloudflare API.
   * Intended to be called periodically (e.g. from a cron job).
   */
  async retryFailedBans(): Promise<{ retried: number; succeeded: number }> {
    const failedBans = await getFailedBans(50);
    let succeeded = 0;

    for (const ban of failedBans) {
      try {
        const isSubnet = ban.ip_address.includes('/');
        const notes = `YapBay API auto-ban retry: ${ban.ban_reason} — ${ban.pattern_matched}`;
        const cfResponse = await CloudflareAPIService.createAccessRule(
          ban.ip_address,
          notes,
          isSubnet ? 'ip_range' : 'ip',
        );

        if (cfResponse.success && cfResponse.result) {
          await updateBanWithApiResult(ban.id, cfResponse.result.id, true);
          succeeded++;
          console.info(`[Security] Retry succeeded for ${ban.ip_address}`);
        }
      } catch (error) {
        console.error(`[Security] Retry failed for ${ban.ip_address}:`, error);
      }
    }

    if (failedBans.length > 0) {
      console.info(`[Security] Ban retry complete: ${succeeded}/${failedBans.length} succeeded`);
    }

    return { retried: failedBans.length, succeeded };
  },
};
