# 0004 — Pino for structured logging with PII redaction

**Status**: Accepted (2026-04-12) — supersedes the earlier synchronous file logger (commit e95ff5e).

## Context

The original logger used `fs.appendFileSync` on every request. Two problems:

1. **Event loop blocking.** Synchronous disk I/O on every request caps
   throughput and makes p99 latency dependent on disk contention.
2. **PII leakage.** Request bodies were written verbatim, including
   wallet addresses in Authorization headers, user emails, and anything
   else a handler happened to receive.

## Decision

Use [Pino](https://getpino.io/) as the structured logger across the
codebase. Configuration lives in [src/logger.ts](../../src/logger.ts):

- **Async transport.** Pino writes JSON to stdout; systemd / Docker logging
  collects it. No synchronous disk I/O.
- **Redaction.** Sensitive paths are redacted at serialization time:
  `authorization`, `cookie`, `x-api-key`, plus body fields matching
  `password`, `token`, `secret`, `private_key`, `privateKey`, `keypair`,
  `seed`, `mnemonic`, `jwk`, `jwt`, `apiKey`, `apiSecret`. Wildcard
  patterns (`*.secret`, `*.key`) catch nested occurrences.
- **Trace correlation.** A `mixin` injects the active OpenTelemetry
  `trace_id` + `span_id` into every log line so logs join traces without
  per-call-site plumbing (see ADR 0005).
- **Test silence.** `NODE_ENV=test` forces level `silent` so mocha output
  stays clean.
- **Dev pretty-printing.** `NODE_ENV=development` pipes through
  `pino-pretty` for human-readable output.

## Consequences

- Log ingestion pipelines expect newline-delimited JSON.
- Adding a new secret-bearing field means updating the redaction list.
  The allowlist-style wildcards (`*.secret`) cover most cases, but novel
  field names (e.g., `apiPassphrase`) need explicit paths.
- `logError('message', err)` stays as the legacy convenience wrapper so
  existing call sites don't need to change.

## Alternatives considered

- **Winston.** More features, heavier, async transports via plugins. Pino
  is purpose-built for high-throughput JSON and outperforms.
- **Console.log with a wrapper.** Doesn't scale — no redaction, no level
  filtering, no structured fields by default.
- **Custom synchronous logger with a BullMQ queue.** Over-engineered for a
  problem Pino solves out of the box.
