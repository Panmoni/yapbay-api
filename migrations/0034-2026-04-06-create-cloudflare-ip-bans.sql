-- Create tables for Cloudflare IP ban tracking and suspicious activity logging

CREATE TABLE IF NOT EXISTS cloudflare_ip_bans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address INET NOT NULL UNIQUE,
  ban_reason TEXT NOT NULL,
  pattern_matched TEXT NOT NULL,
  request_path TEXT,
  user_agent TEXT,
  cloudflare_rule_id TEXT,
  api_success BOOLEAN DEFAULT FALSE,
  api_error_message TEXT,
  banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  unbanned_at TIMESTAMPTZ,
  unban_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suspicious_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  pattern_matched TEXT NOT NULL,
  request_path TEXT NOT NULL,
  request_method TEXT NOT NULL,
  user_agent TEXT,
  ban_attempted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_suspicious_activity_ip ON suspicious_activity_log (ip_address);
CREATE INDEX IF NOT EXISTS idx_suspicious_activity_created ON suspicious_activity_log (created_at);
CREATE INDEX IF NOT EXISTS idx_cf_ip_bans_expires ON cloudflare_ip_bans (expires_at) WHERE unbanned_at IS NULL;
