/**
 * Typed route handler helper.
 *
 * Provides ergonomic types for `req.body`, `req.query`, `req.params`, and
 * `req.headers` inside route handlers, derived from the same Zod schema map
 * passed to {@link validate}.
 *
 * Why a wrapper instead of declaration merging on `Express.Request`:
 * declaration merging types `req.body` identically across every route, which
 * is worse than `any` because it implies type safety that doesn't exist.
 * A per-handler wrapper is explicit, generic, and tracks the actual schema.
 *
 * Usage:
 *
 *   const schemas = { body: createOfferSchema, query: paginationQuery };
 *
 *   router.post(
 *     '/offers',
 *     validate(schemas),
 *     handler(schemas, async (req, res) => {
 *       // req.body is z.infer<typeof createOfferSchema>
 *       // req.query.limit is number (default applied)
 *     }),
 *   );
 *
 * Acknowledged trade-off: `schemas` is referenced twice (in `validate()` and
 * in `handler()`). That explicitness is preferable to magic.
 */

import type { Response } from 'express';
import type { infer as ZodInfer, ZodType } from 'zod';
import type { AuthenticatedRequest } from './auth';

export interface HandlerSchemas {
  body?: ZodType;
  headers?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Augment AuthenticatedRequest so the destructured fields match the schemas
 * exactly. Falls back to the original Express types when a target has no
 * schema declared.
 */
export type TypedRequest<S extends HandlerSchemas> = Omit<
  AuthenticatedRequest,
  'body' | 'query' | 'params' | 'headers'
> & {
  body: S['body'] extends ZodType ? ZodInfer<S['body']> : unknown;
  headers: S['headers'] extends ZodType ? ZodInfer<S['headers']> : AuthenticatedRequest['headers'];
  params: S['params'] extends ZodType ? ZodInfer<S['params']> : AuthenticatedRequest['params'];
  query: S['query'] extends ZodType ? ZodInfer<S['query']> : AuthenticatedRequest['query'];
};

/**
 * Wrap a route handler so its `req` parameter is typed against the schema map.
 *
 * `_schemas` is unused at runtime — its only purpose is to tie the generic
 * parameter to the schemas declared at the call site, so TypeScript knows
 * which Zod types to infer for `req`.
 *
 * Always returns `Promise<void>` so it is compatible with `withErrorHandling`.
 */
export function handler<S extends HandlerSchemas>(
  _schemas: S,
  fn: (req: TypedRequest<S>, res: Response) => Promise<void> | void,
): (req: AuthenticatedRequest, res: Response) => Promise<void> {
  return async (req, res) => {
    await fn(req as unknown as TypedRequest<S>, res);
  };
}
