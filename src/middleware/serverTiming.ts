import type { NextFunction, Request, Response } from 'express';

/**
 * Server-Timing middleware.
 * Measures total request processing time and exposes it via the
 * standard Server-Timing response header (RFC 7838).
 *
 * The header is set by intercepting res.writeHead so the timing
 * is captured just before headers are flushed to the client.
 */
export function serverTimingMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  const originalWriteHead = res.writeHead;

  // biome-ignore lint/suspicious/noExplicitAny: writeHead has multiple overloads
  res.writeHead = function (this: Response, ...args: any[]): Response {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    res.setHeader('Server-Timing', `total;dur=${durationMs.toFixed(1)}`);
    return originalWriteHead.apply(this, args as [number]) as Response;
  };

  next();
}
