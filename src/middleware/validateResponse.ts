/**
 * Response validation middleware.
 *
 * Wraps `res.json()` so that any 2xx response body is parsed against the
 * provided Zod schema before being sent to the client. A schema mismatch is a
 * **500 response_validation_error** — the malformed body is NOT sent. The
 * client gets a generic error and the issues are logged loudly.
 *
 * Why only 2xx: error responses (4xx/5xx) use the standardized
 * `errorResponse.ts` shape which is itself fixed. The interesting drift is in
 * success responses where handlers shape data manually.
 *
 * **No env-flag escape hatch.** If a response schema is wrong, the fix is a
 * code change and a redeploy.
 */

import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { logError } from '../logger';
import { sendResponseValidationError } from '../utils/errorResponse';

export function validateResponse(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);

    res.json = (body: unknown) => {
      // Only validate successful (2xx) responses. Errors flow through
      // unchanged so error handlers don't recursively validate.
      const status = res.statusCode;
      if (status < 200 || status >= 300) {
        return originalJson(body);
      }

      const result = schema.safeParse(body);
      if (result.success) {
        return originalJson(result.data);
      }

      // Schema mismatch — log loudly and replace the body with a 500.
      logError(
        `Response validation failed for ${req.method} ${req.originalUrl}`,
        new Error(
          `Response schema mismatch: ${result.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
        ),
      );

      // Reset status from whatever the handler set to 500.
      res.status(500);
      sendResponseValidationError(req, res, result.error);
      return res;
    };

    next();
  };
}
