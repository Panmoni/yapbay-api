// Load + validate env before any other import that reads process.env.
import './config/env';
// Tracing must initialize before modules it auto-instruments (http, express, pg).
import './tracing';

import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cron from 'node-cron';
import pool, { warmPool } from './db';
import { fetchSolanaEscrowBalance } from './jobs/fetchSolanaEscrowBalance';
import { reconcileEscrowBalances } from './jobs/reconcileEscrowBalances';
import {
  closeListenerLogStreams,
  type MultiNetworkEventListener,
  startMultiNetworkEventListener,
} from './listener/multiNetworkEvents';
import { logger } from './logger';
import { metricsHandler, metricsMiddleware } from './metrics';
import { globalErrorHandler } from './middleware/errorHandler';
import { enforceHTTPS } from './middleware/httpsEnforcement';
import { sweepExpiredIdempotencyRecords } from './middleware/idempotency';
import { defaultRateLimit, suspiciousPatternRateLimit } from './middleware/rateLimiting';
import { requestIdMiddleware } from './middleware/requestId';
import { serverTimingMiddleware } from './middleware/serverTiming';
import { getMatchedPattern, isSuspiciousRequest } from './middleware/suspiciousPatternDetection';
import { openApiJsonHandler, swaggerUiMiddleware } from './openapi';
import routes from './routes';
import { expireDeadlines } from './services/deadlineService';
import { monitorExpiredEscrows } from './services/escrowMonitoringService';
import { isBlocked } from './services/security/inMemoryBlocklist';
import { shutdownTracing } from './tracing';
import { getClientIp, isTrustedIP } from './utils/clientIp';
import { sendErrorResponse } from './utils/errorResponse';

// Global listener reference for health checks
let globalMultiListener: MultiNetworkEventListener | null = null;
let listenerHealthy = false;

export function getListenerHealth(): { healthy: boolean; listenerCount: number } {
  return {
    healthy: listenerHealthy,
    listenerCount: globalMultiListener?.getListenerCount() ?? 0,
  };
}

// Startup sequence
async function startServer(): Promise<void> {
  // Verify DB connectivity and pre-warm the pool in one step.
  try {
    await warmPool();
    console.log('✅ Database connection successful (pool pre-warmed)');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }

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

  // Cron handles are captured so graceful shutdown can stop them before
  // closing the DB pool. Without this, jobs keep firing DB writes during
  // the drain window, risking partial-commit corruption.
  const scheduledTasks: cron.ScheduledTask[] = [];

  const deadlineSchedule = process.env.DEADLINE_CRON_SCHEDULE;
  if (deadlineSchedule) {
    scheduledTasks.push(
      cron.schedule(deadlineSchedule, async () => {
        try {
          console.log(`[Scheduler] Running expireDeadlines: ${new Date().toISOString()}`);
          await expireDeadlines();
        } catch (e) {
          console.error('[Scheduler] expireDeadlines error:', e);
        }
      }),
    );
    console.log(`[Scheduler] Scheduled auto-cancel job: ${deadlineSchedule}`);
  }

  // Escrow monitoring cron job - runs every 1 minute
  const escrowMonitorSchedule = process.env.ESCROW_MONITOR_CRON_SCHEDULE || '* * * * *';
  const escrowMonitorEnabled = process.env.ESCROW_MONITOR_ENABLED === 'true';

  if (escrowMonitorEnabled) {
    scheduledTasks.push(
      cron.schedule(escrowMonitorSchedule, async () => {
        try {
          console.log(`[Scheduler] Running escrow monitoring: ${new Date().toISOString()}`);
          await monitorExpiredEscrows();
        } catch (e) {
          console.error('[Scheduler] escrow monitoring error:', e);
        }
      }),
    );
    console.log(`[Scheduler] Scheduled escrow monitoring job: ${escrowMonitorSchedule}`);
  } else {
    console.log(
      `[Scheduler] Escrow monitoring disabled (ESCROW_MONITOR_ENABLED=${process.env.ESCROW_MONITOR_ENABLED})`,
    );
  }

  // Security maintenance cron — retry failed CF bans + cleanup activity log (daily at 03:00)
  if (process.env.CF_BAN_ENABLED === 'true') {
    scheduledTasks.push(
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
      }),
    );
    console.log('[Scheduler] Scheduled security maintenance job: 0 3 * * *');
  }

  // Idempotency sweep — hourly DELETE of expired records so the table stays
  // lean. The unique index + advisory lock don't require this for
  // correctness, only for performance.
  scheduledTasks.push(
    cron.schedule('13 * * * *', async () => {
      try {
        await sweepExpiredIdempotencyRecords();
      } catch (e) {
        console.error('[Scheduler] idempotency sweep error:', e);
      }
    }),
  );

  // Daily balance reconciliation at 04:00 UTC. Compares on-chain escrow
  // balance against DB `current_balance`; logs + webhooks mismatches. Never
  // writes corrections — human review per runbook.
  const reconcileSchedule = process.env.RECONCILE_CRON_SCHEDULE || '0 4 * * *';
  if (process.env.RECONCILE_ENABLED !== 'false') {
    scheduledTasks.push(
      cron.schedule(reconcileSchedule, async () => {
        try {
          logger.info('[Scheduler] Running escrow reconciliation');
          await reconcileEscrowBalances(fetchSolanaEscrowBalance);
        } catch (e) {
          logger.error({ err: e }, '[Scheduler] reconciliation error');
        }
      }),
    );
    console.log(`[Scheduler] Scheduled reconciliation job: ${reconcileSchedule}`);
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
  //
  // Dev fallback intentionally does NOT include the prod origin
  // (`https://app.yapbay.com`). Combined with `credentials: true`, listing
  // prod here would let an XSS on the prod frontend issue credentialed
  // cross-origin requests against a developer's locally-running API.
  // Set `CORS_ORIGINS=https://app.yapbay.com,http://localhost:5173` if you
  // genuinely need the prod frontend to hit a dev backend.
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : isProduction
      ? ['https://app.yapbay.com']
      : ['http://localhost:5173', 'http://localhost:5174'];

  app.use(
    cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-network-name',
        'X-Request-Id',
        'Idempotency-Key',
      ],
      exposedHeaders: [
        'X-Rate-Limit-Limit',
        'X-Rate-Limit-Remaining',
        'X-Rate-Limit-Reset',
        'X-Rate-Limit-Retry-After',
        'X-Request-Id',
        'Server-Timing',
        'Idempotent-Replayed',
        'Retry-After',
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

  // ── 11b. In-flight counter ─────────────────────────────────────────────
  // Must run BEFORE routes so every request increments the counter. Route
  // handlers call res.json() without next(), so middleware registered after
  // routes never runs. Health/metrics endpoints are excluded from drain
  // accounting to keep probes from pinning shutdown indefinitely.
  let inFlight = 0;
  app.use((req, res, next) => {
    if (req.path.startsWith('/health') || req.path === '/metrics') {
      return next();
    }
    inFlight++;
    let decremented = false;
    const dec = () => {
      if (!decremented) {
        decremented = true;
        inFlight--;
      }
    };
    res.on('finish', dec);
    res.on('close', dec);
    next();
  });

  // ── 12. Global rate limit ──────────────────────────────────────────────
  app.use(defaultRateLimit);

  // ── 12b. Prometheus metrics middleware + endpoint ──────────────────────
  app.use(metricsMiddleware);
  app.get('/metrics', metricsHandler);

  // ── 12c. OpenAPI spec + Swagger UI ─────────────────────────────────────
  // /openapi.json is the machine-readable contract; /api-docs is the
  // Swagger UI. Both are public — they describe the API surface without
  // exposing secrets.
  app.get('/openapi.json', openApiJsonHandler);
  app.use('/api-docs', ...swaggerUiMiddleware);

  // ── 13. Routes ─────────────────────────────────────────────────────────
  app.use('/', routes);

  // Health check endpoints
  // ─ /health/live — liveness probe: process is up. Never hits DB or listeners.
  //   Kubernetes / load balancers use this to decide whether to restart.
  // ─ /health/ready — readiness probe: deps (DB, listener) are healthy and we
  //   should receive traffic. Returning 503 removes us from the LB pool without
  //   a restart.
  // ─ /health — legacy alias for /health/live, kept for backward compatibility
  //   with existing deploy/monitoring scripts.
  const livenessHandler = (_req: express.Request, res: express.Response): void => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  };
  app.get('/health/live', livenessHandler);
  app.get('/health', livenessHandler);

  app.get('/health/ready', async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await pool.query('SELECT 1');
      checks.db = { ok: true };
    } catch (err) {
      // Log the real error server-side; return a generic message to the
      // client so /health/ready can't be probed to enumerate DB hostnames,
      // schema names, or credentials from pg error strings.
      logger.error({ err }, '/health/ready: db check failed');
      checks.db = { ok: false, detail: 'database unavailable' };
    }

    const listener = getListenerHealth();
    checks.listener = listener.healthy
      ? { ok: true, detail: `${listener.listenerCount} listener(s)` }
      : { ok: false, detail: 'listener not healthy' };

    const ready = Object.values(checks).every((c) => c.ok);
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  // ── 14. Global error handler ───────────────────────────────────────────
  // MUST be the last middleware. Catches stray ZodError + uncaught route
  // errors and emits the standardized error response shape.
  app.use(globalErrorHandler);

  // ── Graceful shutdown ──────────────────────────────────────────────────
  // On SIGTERM/SIGINT: stop accepting new connections, wait for in-flight
  // requests to drain (up to SHUTDOWN_TIMEOUT_MS), then stop scheduled jobs
  // and listeners, close DB pool, flush the logger, shut down tracing, and
  // exit. Financial correctness requires we never SIGKILL mid-transaction.
  const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000);
  let shuttingDown = false;

  const PORT = process.env.PORT || 3000;
  const httpServer = app.listen(PORT, () => {
    console.log(`YapBay API running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Solana RPC: ${process.env.SOLANA_RPC_URL_DEVNET ? '[configured]' : '[not set]'}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutdown: signal received, draining');

    // Stop accepting new connections. Existing sockets keep serving.
    httpServer.close((err) => {
      if (err) {
        logger.error({ err }, 'shutdown: http server close error');
      }
    });

    // Drain in-flight requests (poll; cheap and predictable).
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    while (inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (inFlight > 0) {
      logger.warn({ inFlight }, 'shutdown: drain deadline exceeded, forcing close');
    }

    // Stop scheduled jobs before closing the DB pool, otherwise in-flight
    // cron bodies may try to write against a closed pool.
    for (const task of scheduledTasks) {
      try {
        task.stop();
      } catch (err) {
        logger.error({ err }, 'shutdown: cron stop error');
      }
    }

    // Listeners next (they may emit events that touch DB).
    try {
      if (globalMultiListener) {
        await globalMultiListener.stopAllListeners();
      }
    } catch (err) {
      logger.error({ err }, 'shutdown: listener stop error');
    }
    closeListenerLogStreams();

    // Tracing exporter (flushes any pending spans before DB + process exit).
    try {
      await shutdownTracing();
    } catch (err) {
      logger.error({ err }, 'shutdown: tracing shutdown error');
    }

    // DB pool last among service clients.
    try {
      await pool.end();
    } catch (err) {
      logger.error({ err }, 'shutdown: pool end error');
    }

    logger.info('shutdown: complete');
    // Flush pino's async buffer before exiting so the "complete" line and
    // any preceding ERRORs reach stdout. 50ms was too short under load.
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2000);
      logger.flush(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => logger.error({ err }, 'shutdown SIGTERM error'));
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((err) => logger.error({ err }, 'shutdown SIGINT error'));
  });
}

// Start the server
startServer().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
