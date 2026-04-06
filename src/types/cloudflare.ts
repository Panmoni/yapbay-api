/**
 * Cloudflare IP Access Rules integration types
 */

/** Database record for a banned IP */
export interface CloudflareIPBan {
  api_error_message: string | null;
  api_success: boolean;
  ban_reason: string;
  banned_at: string;
  cloudflare_rule_id: string | null;
  created_at: string;
  expires_at: string;
  id: string;
  ip_address: string;
  pattern_matched: string;
  request_path: string | null;
  unban_reason: string | null;
  unbanned_at: string | null;
  updated_at: string;
  user_agent: string | null;
}

/** Data needed to create a new ban record */
export interface CreateBanData {
  ban_reason: string;
  expires_at: Date;
  ip_address: string;
  pattern_matched: string;
  request_path: string;
  user_agent: string;
}

/** Cloudflare API response for access rule operations */
export interface CloudflareAccessRuleResponse {
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result?: {
    id: string;
    paused: boolean;
    mode: string;
    configuration: {
      target: string;
      value: string;
    };
    notes: string;
    created_on: string;
    modified_on: string;
  };
  success: boolean;
}

/** Cloudflare API list response */
export interface CloudflareAccessRuleListResponse {
  errors: Array<{ code: number; message: string }>;
  result: Array<{
    id: string;
    mode: string;
    configuration: {
      target: string;
      value: string;
    };
    notes: string;
    created_on: string;
  }>;
  result_info: {
    page: number;
    per_page: number;
    count: number;
    total_count: number;
    total_pages: number;
  };
  success: boolean;
}

/** Suspicious activity log record */
export interface SuspiciousActivityRecord {
  ban_attempted: boolean;
  ip_address: string;
  pattern_matched: string;
  pattern_type: string;
  request_method: string;
  request_path: string;
  user_agent: string;
}

/** Result of a ban attempt */
export interface BanResult {
  banned: boolean;
  cloudflareRuleId?: string;
  reason: string;
}
