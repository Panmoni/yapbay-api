import compression from 'compression';
import cors from 'cors';
import * as dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cron from 'node-cron';
import { Pool } from 'pg';
import {
  type MultiNetworkEventListener,
  startMultiNetworkEventListener,
} from './listener/multiNetworkEvents';
import { globalErrorHandler } from './middleware/errorHandler';
import { enforceHTTPS } from './middleware/httpsEnforcement';
import { defaultRateLimit, suspiciousPatternRateLimit } from './middleware/rateLimiting';
import { requestIdMiddleware } from './middleware/requestId';
import { serverTimingMiddleware } from './middleware/serverTiming';
import { getMatchedPattern, isSuspiciousRequest } from './middleware/suspiciousPatternDetection';
import routes from './routes';
import { expireDeadlines } from './services/deadlineService';
import { monitorExpiredEscrows } from './services/escrowMonitoringService';
import { isBlocked } from './services/security/inMemoryBlocklist';
import { getClientIp, isTrustedIP } from './utils/clientIp';
import { sendErrorResponse } from './utils/errorResponse';

dotenv.config();

// Validate required environment variables at startup
const REQUIRED_ENV_VARS = ['POSTGRES_URL', 'JWT_SECRET'];
for (const envVar of REQUIRED_ENV_VARS) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Validate Cloudflare env vars if banning is enabled
if (process.env.CF_BAN_ENABLED === 'true') {
  const cfVars = ['CF_API_TOKEN', 'CF_ZONE_ID'];
  for (const envVar of cfVars) {
    if (!process.env[envVar]) {
      console.error(`CF_BAN_ENABLED=true but missing required variable: ${envVar}`);
      process.exit(1);
    }
  }
}

// Global listener reference for health checks
let globalMultiListener: MultiNetworkEventListener | null = null;
let listenerHealthy = false;

export function getListenerHealth(): { healthy: boolean; listenerCount: number } {
  return {
    healthy: listenerHealthy,
    listenerCount: globalMultiListener?.getListenerCount() ?? 0,
  };
}

// Database connection check
async function checkDatabaseConnection(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
  });

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Startup sequence
async function startServer(): Promise<void> {
  // Check database connection first
  await checkDatabaseConnection();

  // Start multi-network event listener for both development and production
  // Note: Currently focused on Solana Devnet only, Celo networks preserved for future re-enablement
  console.log('🚀 Starting multi-network event listener...');
  console.log('📝 Note: Currently focused on Solana Devnet only');
  console.log('📝 Note: Celo networks are preserved but disabled for future re-enablement');

  globalMultiListener = startMultiNetworkEventListener();
  globalMultiListener
    .startAllListeners()
    .then(() => {
      listenerHealthy = true;
      console.log('✅ Multi-network event listener startup completed');
    })
    .catch((error) => {
      listenerHealthy = false;
      console.error('❌ Event listener startup issues:', error);
      console.log('⚠️  API will continue running without real-time blockchain monitoring');
    });

  const deadlineSchedule = process.env.DEADLINE_CRON_SCHEDULE;
  if (deadlineSchedule) {
    cron.schedule(deadlineSchedule, async () => {
      try {
        console.log(`[Scheduler] Running expireDeadlines: ${new Date().toISOString()}`);
        await expireDeadlines();
      } catch (e) {
        console.error('[Scheduler] expireDeadlines error:', e);
      }
    });
    console.log(`[Scheduler] Scheduled auto-cancel job: ${deadlineSchedule}`);
  }

  // Escrow monitoring cron job - runs every 1 minute
  const escrowMonitorSchedule = process.env.ESCROW_MONITOR_CRON_SCHEDULE || '* * * * *';
  const escrowMonitorEnabled = process.env.ESCROW_MONITOR_ENABLED === 'true';

  if (escrowMonitorEnabled) {
    cron.schedule(escrowMonitorSchedule, async () => {
      try {
        console.log(`[Scheduler] Running escrow monitoring: ${new Date().toISOString()}`);
        await monitorExpiredEscrows();
      } catch (e) {
        console.error('[Scheduler] escrow monitoring error:', e);
      }
    });
    console.log(`[Scheduler] Scheduled escrow monitoring job: ${escrowMonitorSchedule}`);
  } else {
    console.log(
      `[Scheduler] Escrow monitoring disabled (ESCROW_MONITOR_ENABLED=${process.env.ESCROW_MONITOR_ENABLED})`,
    );
  }

  // Security maintenance cron — retry failed CF bans + cleanup activity log (daily at 03:00)
  if (process.env.CF_BAN_ENABLED === 'true') {
    cron.schedule('0 3 * * *', async () => {
      try {
        const { CloudflareIPBanService } = await import(
          './services/security/cloudflareIPBanService'
        );
        await CloudflareIPBanService.retryFailedBans();
      } catch (e) {
        console.error('[Scheduler] Failed ban retry error:', e);
      }
      try {
        const { cleanupSuspiciousActivityLog } = await import(
          './services/security/cloudflareIPBanDatabaseService'
        );
        const deleted = await cleanupSuspiciousActivityLog(30);
        if (deleted > 0) {
          console.log(`[Scheduler] Cleaned up ${deleted} suspicious activity log entries`);
        }
      } catch (e) {
        console.error('[Scheduler] Activity log cleanup error:', e);
      }
    });
    console.log('[Scheduler] Scheduled security maintenance job: 0 3 * * *');
  }

  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';

  // ── 1. Trust proxy ──────────────────────────────────────────────────────
  app.set('trust proxy', Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10));

  // ── 2. Request timeout ──────────────────────────────────────────────────
  const requestTimeoutMs = Number.parseInt(process.env.EXPRESS_REQUEST_TIMEOUT_MS || '35000', 10);
  app.use((req, res, next) => {
    req.setTimeout(requestTimeoutMs);
    res.setTimeout(requestTimeoutMs);
    next();
  });

  // ── 3. Request ID ──────────────────────────────────────────────────────
  app.use(requestIdMiddleware);

  // ── 4. Server Timing ───────────────────────────────────────────────────
  app.use(serverTimingMiddleware);

  // ── 5. Helmet (security headers) ──────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: isProduction
        ? {
            maxAge: Number.parseInt(process.env.HSTS_MAX_AGE || '31536000', 10),
            includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS === 'true',
            preload: process.env.HSTS_PRELOAD === 'true',
          }
        : false,
    }),
  );

  // ── 6. CORS ────────────────────────────────────────────────────────────
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : isProduction
      ? ['https://app.yapbay.com']
      : ['https://app.yapbay.com', 'http://localhost:5173', 'http://localhost:5174'];

  app.use(
    cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-network-name', 'X-Request-Id'],
      exposedHeaders: [
        'X-Rate-Limit-Limit',
        'X-Rate-Limit-Remaining',
        'X-Rate-Limit-Reset',
        'X-Rate-Limit-Retry-After',
        'X-Request-Id',
        'Server-Timing',
      ],
      credentials: true,
    }),
  );

  // ── 7. Suspicious pattern detection + in-memory blocklist ─────────────
  app.use((req, res, next) => {
    const clientIP = getClientIp(req);

    // Fast path: check in-memory blocklist
    if (isBlocked(clientIP)) {
      sendErrorResponse(req, res, 403, 'ip_blocked', 'Access denied');
      return;
    }

    // Check for suspicious patterns (skip for trusted IPs and authenticated users)
    if (isSuspiciousRequest(req) && !isTrustedIP(clientIP) && !req.headers.authorization) {
      const matched = getMatchedPattern(req);
      console.warn(
        `[Security] Suspicious request from ${clientIP}: ${matched?.type} — ${matched?.pattern} — ${req.method} ${req.originalUrl}`,
      );

      // Fire-and-forget Cloudflare ban (only if enabled)
      if (process.env.CF_BAN_ENABLED === 'true' && matched) {
        import('./services/security/cloudflareIPBanService')
          .then(({ CloudflareIPBanService }) =>
            CloudflareIPBanService.processSuspiciousRequest(
              clientIP,
              matched.type,
              matched.pattern,
              req.originalUrl || req.path,
              req.method,
              req.get('User-Agent') || '',
            ),
          )
          .catch((err) => console.error('[Security] Ban processing error:', err));
      }

      // Apply stricter rate limit for suspicious requests
      suspiciousPatternRateLimit(req, res, next);
      return;
    }

    next();
  });

  // ── 8. HTTPS enforcement ───────────────────────────────────────────────
  app.use(enforceHTTPS);

  // ── 9. Logging ─────────────────────────────────────────────────────────
  app.use(morgan('dev'));

  // ── 10. Compression ────────────────────────────────────────────────────
  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      level: 6,
      threshold: 1024,
    }),
  );

  // ── 11. Body parsing ──────────────────────────────────────────────────
  app.use(express.json({ limit: '100kb' }));

  // ── 12. Global rate limit ──────────────────────────────────────────────
  app.use(defaultRateLimit);

  // ── 13. Routes ─────────────────────────────────────────────────────────
  app.use('/', routes);

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── 14. Global error handler ───────────────────────────────────────────
  // MUST be the last middleware. Catches stray ZodError + uncaught route
  // errors and emits the standardized error response shape.
  app.use(globalErrorHandler);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`YapBay API running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Solana RPC: ${process.env.SOLANA_RPC_URL_DEVNET ? '[configured]' : '[not set]'}`);
  });
}

// Start the server
startServer().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
