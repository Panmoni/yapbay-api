import type { NextFunction, Request, Response } from 'express';
import pino from 'pino';
import { env } from './config/env';

/**
 * Structured application logger backed by Pino.
 *
 * - Prod/staging: JSON to stdout (picked up by journald via the systemd service).
 * - Development: pino-pretty for human-readable output.
 * - Tests: silenced to keep the Mocha reporter clean.
 *
 * The previous implementation used synchronous `fs.appendFileSync` on every
 * request and wrote raw request bodies to disk — that blocks the event loop
 * and leaks PII. Pino writes asynchronously and redacts authorization,
 * cookies, and common secret-bearing fields at serialization time.
 */

const isTest = env.NODE_ENV === 'test';
const isDev = env.NODE_ENV === 'development';

const transport = isDev
  ? {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
    }
  : undefined;

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'headers.authorization',
      'headers.cookie',
      'headers["x-api-key"]',
      'body.password',
      'body.token',
      'body.secret',
      'body.private_key',
      'body.privateKey',
      'body.privateKeyHex',
      'body.keypair',
      'body.seed',
      'body.mnemonic',
      'body.jwk',
      'body.jwt',
      'body.apiKey',
      'body.apiSecret',
      '*.password',
      '*.token',
      '*.secret',
      '*.private_key',
      '*.privateKey',
      '*.privateKeyHex',
      '*.keypair',
      '*.seed',
      '*.mnemonic',
      '*.jwk',
      '*.apiKey',
      '*.apiSecret',
    ],
    censor: '***REDACTED***',
  },
  ...(transport && { transport }),
});

/**
 * Express middleware: logs method, path, status, and duration for every
 * request. Bodies are NOT logged by default (set LOG_BODY=1 in dev only).
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const entry: Record<string, unknown> = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
      requestId: req.requestId,
    };
    if (env.LOG_BODY) {
      entry.body = req.body;
    }
    if (res.statusCode >= 500) {
      logger.error(entry, 'request failed');
    } else if (res.statusCode >= 400) {
      logger.warn(entry, 'request');
    } else {
      logger.info(entry, 'request');
    }
  });
  next();
};

/**
 * Log an error with a message. Kept API-compatible with the previous
 * file-based logger so existing call sites don't need edits.
 */
export const logError = (message: string, error: unknown) => {
  if (error instanceof Error) {
    logger.error({ err: error }, message);
  } else {
    logger.error({ error }, message);
  }
};
