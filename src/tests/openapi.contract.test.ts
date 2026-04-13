// Contract test: every router handler in src/routes/ must have a matching
// path registration in the OpenAPI spec. Keeps the human-facing API
// reference (Swagger UI) honest without waiting for a QA sweep.
//
// Run via `pnpm test:property` — no DB needed, no network calls, pure AST
// + source scan. Runs in ~300 ms.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'chai';
import { generateOpenApiDocument } from '../openapi';

const ROUTES_DIR = join(__dirname, '..', 'routes');

// Route files we don't expect to see in OpenAPI:
// - index.ts files just mount sub-routers; they don't define handlers
// - middleware.ts / businessValidation.ts aren't handlers
const SKIP_FILENAMES = new Set(['index.ts', 'middleware.ts', 'businessValidation.ts']);

// Paths handled by the existing authRouter `/admin/*` prefix but declared
// as bare `/login` inside the router (mounted at `/admin` in auth/index).
// The registrar uses the effective path; the source grep sees the raw.
const SOURCE_TO_SPEC_REWRITES: [RegExp, string][] = [[/^\/login$/, '/admin/login']];

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walkTs(full, acc);
    } else if (entry.endsWith('.ts') && !SKIP_FILENAMES.has(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

interface SourceRoute {
  file: string;
  method: string;
  path: string;
}

function extractRoutes(file: string): SourceRoute[] {
  const content = readFileSync(file, 'utf8');
  const re = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
  const found: SourceRoute[] = [];
  let match = re.exec(content);
  while (match !== null) {
    found.push({ method: match[1].toLowerCase(), path: match[2], file });
    match = re.exec(content);
  }
  return found;
}

// Convert an Express-style path ("/admin/deadline-stats/:id") to an OpenAPI
// path ("/admin/deadline-stats/{id}") so we can match across the two.
function normalize(expressPath: string): string {
  return expressPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}

// Router files are mounted with a prefix; we can't know the full URL from
// the leaf file alone. The map below mirrors src/routes/index.ts so the
// contract test compares the right path. Keep in sync when routes move.
const ROUTER_PREFIX: Record<string, string> = {
  'src/routes/public.ts': '',
  'src/routes/health/index.ts': '/health',
  'src/routes/auth/admin.ts': '/admin',
  'src/routes/admin/trades.ts': '/admin/trades',
  'src/routes/admin/escrows.ts': '/admin/escrows',
  'src/routes/admin/deadlines.ts': '/admin/deadline-stats',
  'src/routes/accounts/crud.ts': '/accounts',
  'src/routes/offers/public.ts': '/offers',
  'src/routes/offers/crud.ts': '/offers',
  'src/routes/trades/crud.ts': '/trades',
  'src/routes/escrows/operations.ts': '/escrows',
  'src/routes/escrows/blockchain.ts': '/escrows',
  'src/routes/transactions/record.ts': '/transactions',
  'src/routes/transactions/lookup.ts': '/transactions',
};

// Route files deliberately excluded from OpenAPI coverage (e.g. internal
// scaffolding, not user-facing). Add here with a comment explaining why.
const UNMAPPED_ALLOWED = new Set<string>([
  // (none currently)
]);

function effectivePath(file: string, rawPath: string): string | null {
  const rel = file.split(`${process.cwd()}/`).pop() ?? file;
  if (UNMAPPED_ALLOWED.has(rel)) {
    return null;
  }
  const prefix = ROUTER_PREFIX[rel];
  if (prefix === undefined) {
    // A new route file landed without being added to ROUTER_PREFIX. The
    // contract test is meaningless if we silently skip — every route must
    // either be mapped (so its OpenAPI registration is verified) or
    // explicitly allow-listed above with a justification.
    throw new Error(
      `unmapped route file: ${rel}. Add it to ROUTER_PREFIX in this test, or to UNMAPPED_ALLOWED with a comment.`,
    );
  }
  let combined = `${prefix}${rawPath === '/' ? '' : rawPath}`.replace(/\/+/g, '/');
  if (combined === '') {
    combined = '/';
  }
  combined = normalize(combined);
  for (const [pattern, replacement] of SOURCE_TO_SPEC_REWRITES) {
    if (pattern.test(combined)) {
      combined = combined.replace(pattern, replacement);
    }
  }
  return combined;
}

describe('OpenAPI contract', () => {
  const doc = generateOpenApiDocument();
  const registeredPaths = new Set<string>();
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(methods as object)) {
      registeredPaths.add(`${method.toLowerCase()} ${path}`);
    }
  }

  const files = walkTs(ROUTES_DIR);
  const sourceRoutes: SourceRoute[] = [];
  for (const f of files) {
    sourceRoutes.push(...extractRoutes(f));
  }

  it('every router handler in src/routes has a registered OpenAPI path', () => {
    const missing: string[] = [];
    for (const r of sourceRoutes) {
      const eff = effectivePath(r.file, r.path);
      if (eff === null) {
        continue;
      }
      const key = `${r.method} ${eff}`;
      if (!registeredPaths.has(key)) {
        missing.push(`${key}   (from ${r.file})`);
      }
    }
    if (missing.length > 0) {
      expect.fail(
        `Missing OpenAPI registrations (${missing.length}):\n  - ${missing.join('\n  - ')}`,
      );
    }
  });
});
