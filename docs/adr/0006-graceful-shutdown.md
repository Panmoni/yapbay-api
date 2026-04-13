# 0006 — Coordinated graceful shutdown

**Status**: Accepted (2026-04-12)

## Context

A financial service that SIGKILLs mid-transaction corrupts state. The DB
may have committed half the work; the blockchain may have received a
transaction the backend never recorded; event listeners may miss a window
of state transitions. The prior deploy script relied on systemd's default
stop behavior (SIGTERM → 90s timeout → SIGKILL) with no app-level drain.

Signal handlers were also fragmented: the multi-network event listener
registered its own SIGTERM/SIGINT handlers, and the OTel SDK bootstrap
added more, leading to race conditions.

## Decision

`src/server.ts` owns the single shutdown sequence:

1. `httpServer.close()` — stop accepting new connections.
2. Drain in-flight requests up to `SHUTDOWN_TIMEOUT_MS` (default 30 s).
   The counter middleware is mounted BEFORE routes so it actually runs
   (mounting it after `app.use('/', routes)` was a P0 bug caught in
   review — routes terminate without `next()` so later middleware never
   executes). Counter uses a single-fire flag because both `finish` and
   `close` events fire on normal completion.
3. Stop all captured cron tasks. Handles are stored in an array at
   registration so `task.stop()` can be called on each.
4. Stop the multi-network event listener.
5. Call `shutdownTracing()` to flush OpenTelemetry spans.
6. End the pg pool.
7. Flush Pino (`logger.flush()` with 2 s safety timeout) before
   `process.exit(0)`. The earlier `setTimeout(..., 50)` lost tail logs
   under load.

Health probes are split so LBs can drain cleanly:
- `/health/live` — process alive, never touches DB.
- `/health/ready` — DB + listener healthy, returns 503 on not-ready.

## Consequences

- Deploys must send SIGTERM (not SIGKILL) and wait at least
  `SHUTDOWN_TIMEOUT_MS` before declaring failure. systemd unit's
  `TimeoutStopSec=` should match.
- New cron jobs must register via the `scheduledTasks` array, otherwise
  they'll keep firing during drain. Convention enforced by code review
  (no automated guard yet).
- Tracing spans still in-flight at shutdown time are flushed best-effort
  — a small number may be lost if the exporter endpoint is unreachable
  during the 2 s logger flush window.

## Alternatives considered

- **PM2's graceful shutdown.** We run under systemd, not PM2.
- **Let systemd handle it entirely.** systemd can send SIGTERM and wait,
  but the app still needs to drain connections and close the pool itself.
- **No drain — just exit fast.** Unacceptable for a financial system.
