// Centralized, non-throwing JSON parsing for request/DB data whose shape is
// uncertain. Callers that need a validated shape should pass a Zod schema;
// callers that only need "parsed-or-null" can omit it.
//
// Why: raw JSON.parse() scattered through route handlers historically swallowed
// errors ad-hoc or risked crashing the request. A single helper keeps the
// failure mode consistent and makes SAST rules (Phase 2) easy to target.

import type { ZodType } from 'zod';

export interface SafeJsonOptions<T> {
  onError?: (err: Error, input: unknown) => void;
  schema?: ZodType<T>;
}

/**
 * Parse untrusted JSON without throwing. Returns null on any failure
 * (parse error or schema mismatch). If `input` is already an object, it is
 * returned as-is (after schema validation, if provided).
 */
export function safeJsonParse<T = unknown>(
  input: unknown,
  options: SafeJsonOptions<T> = {},
): T | null {
  if (input == null) {
    return null;
  }

  let parsed: unknown;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (err) {
      options.onError?.(err as Error, input);
      return null;
    }
  } else {
    parsed = input;
  }

  if (options.schema) {
    const result = options.schema.safeParse(parsed);
    if (!result.success) {
      options.onError?.(new Error(result.error.message), input);
      return null;
    }
    return result.data;
  }

  return parsed as T;
}
