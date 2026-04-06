/**
 * Cloudflare API Service
 *
 * Handles IP Access Rule operations via Cloudflare's REST API.
 * Used to ban/unban IPs detected by the suspicious pattern middleware.
 */

import axios from 'axios';
import type {
  CloudflareAccessRuleListResponse,
  CloudflareAccessRuleResponse,
} from '../../types/cloudflare';

const BASE_URL = 'https://api.cloudflare.com/client/v4';
const REQUEST_TIMEOUT_MS = 10_000; // 10 seconds

function getToken(): string {
  const token = process.env.CF_API_TOKEN;
  if (!token) {
    throw new Error('CF_API_TOKEN environment variable is not set');
  }
  return token;
}

function getZoneId(): string {
  const zoneId = process.env.CF_ZONE_ID;
  if (!zoneId) {
    throw new Error('CF_ZONE_ID environment variable is not set');
  }
  return zoneId;
}

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json',
  };
}

/** Extract error info from an axios error with proper type narrowing */
function extractAxiosError(
  error: unknown,
  context: string,
): { errors: Array<{ code: number; message: string }> } {
  if (axios.isAxiosError(error)) {
    const cfErrors = error.response?.data?.errors as
      | Array<{ code: number; message: string }>
      | undefined;
    console.error(
      `[CloudflareAPI] Failed to ${context}:`,
      error.response?.status,
      cfErrors,
      error.message,
    );
    return { errors: cfErrors || [{ code: 0, message: error.message }] };
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[CloudflareAPI] Failed to ${context}:`, message);
  return { errors: [{ code: 0, message }] };
}

/** Handle axios error and return a failed CloudflareAccessRuleResponse */
function handleAxiosError(error: unknown, context: string): CloudflareAccessRuleResponse {
  const errInfo = extractAxiosError(error, context);
  return { success: false, errors: errInfo.errors, messages: [] };
}

export const CloudflareAPIService = {
  /**
   * Create an IP Access Rule to block an IP or IP range.
   * @param target - 'ip' for a single IP, 'ip_range' for a CIDR like 185.177.72.0/24
   */
  async createAccessRule(
    ip: string,
    notes: string,
    target: 'ip' | 'ip_range' = 'ip',
  ): Promise<CloudflareAccessRuleResponse> {
    const zoneId = getZoneId();
    const url = `${BASE_URL}/zones/${zoneId}/firewall/access_rules/rules`;

    try {
      const response = await axios.post<CloudflareAccessRuleResponse>(
        url,
        {
          mode: 'block',
          configuration: { target, value: ip },
          notes,
        },
        { headers: getHeaders(), timeout: REQUEST_TIMEOUT_MS },
      );

      return response.data;
    } catch (error: unknown) {
      return handleAxiosError(error, `create access rule for ${ip}`);
    }
  },

  /**
   * Delete an IP Access Rule (unban)
   */
  async deleteAccessRule(ruleId: string): Promise<CloudflareAccessRuleResponse> {
    const zoneId = getZoneId();
    const url = `${BASE_URL}/zones/${zoneId}/firewall/access_rules/rules/${ruleId}`;

    try {
      const response = await axios.delete<CloudflareAccessRuleResponse>(url, {
        headers: getHeaders(),
        timeout: REQUEST_TIMEOUT_MS,
      });

      return response.data;
    } catch (error: unknown) {
      return handleAxiosError(error, `delete access rule ${ruleId}`);
    }
  },

  /**
   * List IP Access Rules (for admin/debugging)
   */
  async listAccessRules(page = 1, perPage = 50): Promise<CloudflareAccessRuleListResponse> {
    const zoneId = getZoneId();
    const url = `${BASE_URL}/zones/${zoneId}/firewall/access_rules/rules`;

    try {
      const response = await axios.get<CloudflareAccessRuleListResponse>(url, {
        headers: getHeaders(),
        params: { page, per_page: perPage },
        timeout: REQUEST_TIMEOUT_MS,
      });

      return response.data;
    } catch (error: unknown) {
      const errInfo = extractAxiosError(error, 'list access rules');

      return {
        success: false,
        result: [],
        errors: errInfo.errors,
        result_info: { page, per_page: perPage, count: 0, total_count: 0, total_pages: 0 },
      };
    }
  },
};
