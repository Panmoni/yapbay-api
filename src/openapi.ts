// OpenAPI 3.1 spec generator + Swagger UI mount.
//
// Strategy: central registry from @asteasolutions/zod-to-openapi. Schemas
// participate by calling `.openapi({ ... })` on the Zod object; routes
// participate by calling `registry.registerPath(...)`. Anything not yet
// registered simply doesn't appear in the spec — incremental migration is
// fine.
//
// The spec is generated ONCE at module load and cached. Rationale:
// - `swaggerUi.setup(doc)` snapshots the doc at mount time anyway.
// - `/openapi.json` must not be a CPU-amplification vector for unauth
//   clients. Regenerating on every request was both wasteful and an easy
//   DoS.
// - Consequence: routes registered after server start don't appear. All
//   registration happens at module-load time (this file imports once).
//
// Descriptions intentionally avoid naming specific env vars or revealing
// server-side auth fallback paths — the spec is public and should not be a
// reconnaissance surface.

import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import type { Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const openApiRegistry = new OpenAPIRegistry();

// ── Common components ────────────────────────────────────────────────

const idempotencyKeyHeader = openApiRegistry.registerParameter(
  'IdempotencyKey',
  z
    .string()
    .uuid()
    .openapi({
      param: { name: 'Idempotency-Key', in: 'header' },
      description:
        'UUID v4. See "Idempotency" in docs/api-ref.md. Recommended on retryable mutations.',
      example: '9d6b9e4c-3a2f-4f1a-8b8d-2b5a6e0f5b21',
    }),
);

const bearerAuth = openApiRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Bearer JWT.',
});

// ── Schemas ──────────────────────────────────────────────────────────

const HealthLiveResponse = openApiRegistry.register(
  'HealthLiveResponse',
  z
    .object({
      status: z.literal('ok'),
      timestamp: z.string().datetime(),
    })
    .openapi({ description: 'Liveness probe response.' }),
);

const HealthCheck = z.object({
  ok: z.boolean(),
  detail: z.string().optional(),
});

const HealthReadyResponse = openApiRegistry.register(
  'HealthReadyResponse',
  z
    .object({
      status: z.enum(['ready', 'not_ready']),
      timestamp: z.string().datetime(),
      checks: z.object({ db: HealthCheck, listener: HealthCheck }),
    })
    .openapi({ description: 'Readiness probe response. 503 when not ready.' }),
);

openApiRegistry.register(
  'IdempotencyConflictResponse',
  z.object({
    error: z.literal('idempotency_key_conflict'),
    message: z.string(),
  }),
);

// ── Paths ────────────────────────────────────────────────────────────

openApiRegistry.registerPath({
  method: 'get',
  path: '/health/live',
  summary: 'Liveness probe',
  description: 'Returns 200 as long as the process is alive. Never touches DB.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Process alive',
      content: { 'application/json': { schema: HealthLiveResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/health/ready',
  summary: 'Readiness probe',
  description:
    'Checks DB and listener dependencies. Returns 503 when any check fails so load balancers drain this instance without triggering a restart.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Ready for traffic',
      content: { 'application/json': { schema: HealthReadyResponse } },
    },
    503: {
      description: 'Not ready — do not route traffic',
      content: { 'application/json': { schema: HealthReadyResponse } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/metrics',
  summary: 'Prometheus scrape endpoint',
  description: 'Prometheus-format metrics. Requires authentication in production.',
  tags: ['Observability'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Prometheus exposition format (text/plain)',
      content: { 'text/plain': { schema: z.string() } },
    },
    401: { description: 'Missing or invalid credentials' },
    503: { description: 'Endpoint not configured in current environment' },
  },
});

// ── Generator ────────────────────────────────────────────────────────

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(openApiRegistry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'yapbay-api',
      version: process.env.npm_package_version ?? '0.0.0',
      description:
        'Financial P2P crypto escrow API. See docs/api-ref.md for the human-readable contract; this document is machine-generated from Zod schemas where registered.',
      contact: { name: 'YapBay', url: 'https://app.yapbay.com' },
      license: { name: 'MIT' },
    },
    servers: [
      { url: 'https://api.yapbay.com', description: 'Production' },
      { url: 'http://localhost:3011', description: 'Local dev' },
    ],
  });
}

// Generate once at module load and serve the cached document for every
// subsequent request. Routes registered after this module first imports
// will NOT appear until restart — all registration must run at import.
const CACHED_DOCUMENT = generateOpenApiDocument();
const CACHED_DOCUMENT_JSON = JSON.stringify(CACHED_DOCUMENT);

// ── Express mount helpers ────────────────────────────────────────────

export const openApiJsonHandler = (_req: Request, res: Response): void => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(CACHED_DOCUMENT_JSON);
};

export const swaggerUiMiddleware = [
  swaggerUi.serve,
  swaggerUi.setup(CACHED_DOCUMENT, {
    explorer: false,
    customSiteTitle: 'yapbay-api — API reference',
  }),
] as const;

// Keep references exported so tree-shaking can't drop them and future
// registrations (e.g. routes that reference the header) can import them.
export const _registered = { bearerAuth, idempotencyKeyHeader };
