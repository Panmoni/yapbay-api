import path from 'node:path';
import * as dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Priority-based dotenv loading: `.env` → `.env.${NODE_ENV}` → `.env.local`
 * (last write wins). `.env.local` is for personal overrides and must stay
 * gitignored.
 */
function loadDotenvFiles(): void {
  const envName = process.env.NODE_ENV || 'development';
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), `.env.${envName}`),
    path.resolve(process.cwd(), '.env.local'),
  ];
  for (const file of candidates) {
    dotenv.config({ path: file, override: true });
  }
}

loadDotenvFiles();

const boolFromString = (defaultValue = false) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) {
        return defaultValue;
      }
      return v.toLowerCase() === 'true' || v === '1';
    });

const intFromString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') {
        return defaultValue;
      }
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `not an integer: ${v}` });
        return z.NEVER;
      }
      return n;
    });

const baseSchema = z
  .object({
    // Deliberately loose — deploys sometimes set NODE_ENV to values like
    // "staging" or "preview", and hard-failing startup over an unknown label
    // would be worse than just treating it as non-prod.
    NODE_ENV: z.string().default('development'),
    PORT: intFromString(3000),

    // Core — required
    POSTGRES_URL: z.string().min(1, 'POSTGRES_URL is required'),
    JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),

    // Auth
    JWT_AUDIENCE: z.string().optional(),
    ADMIN_USERNAME: z.string().optional(),
    ADMIN_PASSWORD_HASH: z.string().optional(),

    // HTTPS / proxy
    ENFORCE_HTTPS: z
      .string()
      .optional()
      .transform((v) => v !== 'false'),
    TRUST_PROXY_HOPS: intFromString(1),
    EXPRESS_REQUEST_TIMEOUT_MS: intFromString(35_000),
    HSTS_MAX_AGE: intFromString(31_536_000),
    HSTS_INCLUDE_SUBDOMAINS: boolFromString(false),
    HSTS_PRELOAD: boolFromString(false),

    // CORS
    CORS_ORIGINS: z.string().optional(),

    // Cloudflare ban (conditional)
    CF_BAN_ENABLED: boolFromString(false),
    CF_API_TOKEN: z.string().optional(),
    CF_ZONE_ID: z.string().optional(),
    CF_BAN_EXPIRY_DAYS: intFromString(180),
    CF_SUBNET_ESCALATION_THRESHOLD: intFromString(2),
    CF_TRUSTED_IPS: z.string().optional(),
    CF_BEHIND: boolFromString(false),

    // Schedulers
    DEADLINE_CRON_SCHEDULE: z.string().optional(),
    ESCROW_MONITOR_CRON_SCHEDULE: z.string().default('* * * * *'),
    ESCROW_MONITOR_ENABLED: boolFromString(false),
    ESCROW_MONITOR_BATCH_SIZE: intFromString(50),
    AUTO_CANCEL_DELAY_HOURS: intFromString(1),

    // Networks / blockchain
    USE_TESTNET: boolFromString(false),
    SOLANA_RPC_URL_DEVNET: z.string().optional(),
    SOLANA_ARBITRATOR_KEYPAIR: z.string().optional(),
    CELO_PRIVATE_KEY: z.string().optional(),
    CONTRACT_ADDRESS: z.string().optional(),
    CONTRACT_VERSION: z.string().optional(),
    ARBITRATOR_ADDRESS: z.string().optional(),

    // External services
    PRICING_SERVER_URL: z.string().optional(),

    // Pool tuning (consumed by db.ts)
    DB_POOL_MAX: intFromString(20),
    DB_POOL_MIN: intFromString(2),
    DB_POOL_IDLE_TIMEOUT_MS: intFromString(30_000),
    DB_POOL_CONNECTION_TIMEOUT_MS: intFromString(10_000),
    DB_STATEMENT_TIMEOUT_MS: intFromString(30_000),
    DB_QUERY_TIMEOUT_MS: intFromString(30_000),

    // Logging
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    LOG_BODY: boolFromString(false),

    // Version metadata (optional)
    GIT_COMMIT_HASH: z.string().optional(),
    GIT_BRANCH: z.string().optional(),
    GITHUB_REPO_OWNER: z.string().optional(),
    GITHUB_REPO_NAME: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.CF_BAN_ENABLED) {
      if (!v.CF_API_TOKEN) {
        ctx.addIssue({
          path: ['CF_API_TOKEN'],
          code: z.ZodIssueCode.custom,
          message: 'CF_API_TOKEN is required when CF_BAN_ENABLED=true',
        });
      }
      if (!v.CF_ZONE_ID) {
        ctx.addIssue({
          path: ['CF_ZONE_ID'],
          code: z.ZodIssueCode.custom,
          message: 'CF_ZONE_ID is required when CF_BAN_ENABLED=true',
        });
      }
    }
  });

export type Env = z.infer<typeof baseSchema>;

function parseEnv(): Env {
  const result = baseSchema.safeParse(process.env);
  if (!result.success) {
    console.error('[env] Environment validation failed:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }
  return result.data;
}

export const env: Env = parseEnv();
