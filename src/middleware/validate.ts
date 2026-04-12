/**
 * Request validation middleware.
 *
 * Validates `req.body`, `req.query`, `req.params`, and `req.headers` against
 * Zod schemas. On success, replaces the request fields with the parsed
 * (and possibly transformed/coerced) values so route handlers see typed data.
 * On failure, returns a 400 with the standardized validation_error response.
 *
 * **No env-flag escape hatch.** Validation runs on every request, always.
 * If a schema is wrong, the fix is a code change and a redeploy.
 *
 * Two call signatures:
 *
 *   1. Static schema map (the common case):
 *      `validate({ body: createOfferSchema, query: paginationQuery })`
 *
 *   2. Factory taking the request (for network-aware/polymorphic schemas):
 *      `validate((req) => ({ body: escrowRecordSchemaFor(req.network!.networkFamily) }))`
 */

import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { sendValidationError } from '../utils/errorResponse';

export type ValidationTarget = 'params' | 'query' | 'headers' | 'body';

export type SchemaMap = Partial<Record<ValidationTarget, ZodType>>;

export type SchemaFactory = (req: Request) => SchemaMap;

/**
 * Validation order: cheapest-to-fail first. Params and query are validated
 * before headers and body so a malformed URL is rejected before we read the
 * (potentially large) request body. Body is last so its issues do not mask
 * earlier ones.
 */
const TARGET_ORDER: ValidationTarget[] = ['params', 'query', 'headers', 'body'];

export function validate(input: SchemaMap | SchemaFactory) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const schemas = typeof input === 'function' ? input(req) : input;

    // Parse all targets first; only mutate req after every parse succeeds.
    // This avoids leaving req in a half-parsed state if a later target fails.
    const parsed: Partial<Record<ValidationTarget, unknown>> = {};

    for (const target of TARGET_ORDER) {
      const schema = schemas[target];
      if (!schema) {
        continue;
      }
      const result = schema.safeParse(req[target]);
      if (!result.success) {
        sendValidationError(req, res, target, result.error);
        return;
      }
      parsed[target] = result.data;
    }

    // All targets passed — write parsed values back to req.
    // Express 5 may freeze req.query; assign field-by-field via Object.assign
    // for params/query/headers (which are objects), and direct assign for body.
    if (parsed.params !== undefined) {
      // params is always an object; merge in place to preserve any extra
      // properties Express may have set (route metadata, etc.)
      Object.assign(req.params, parsed.params);
    }
    if (parsed.query !== undefined) {
      // Same as params — merge in place rather than reassigning to avoid
      // tripping Express 5's getter on req.query.
      Object.assign(req.query, parsed.query);
    }
    if (parsed.headers !== undefined) {
      Object.assign(req.headers, parsed.headers);
    }
    if (parsed.body !== undefined) {
      req.body = parsed.body;
    }

    next();
  };
}
