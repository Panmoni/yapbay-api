/**
 * HTTP header primitives.
 *
 * Headers are validated as **loose objects** rather than strict, because
 * Express forwards system headers (`host`, `accept`, `user-agent`, `connection`,
 * `content-type`, `content-length`, etc.) that we don't want to enumerate
 * per-route. Application headers we care about (`x-network-name`,
 * `authorization`) MUST be declared in the route's header schema.
 *
 * Note: Express normalizes header names to lowercase. All keys here are
 * lowercase to match.
 */

import { z } from 'zod';
import { networkTypeEnum } from './enums';

/**
 * Validates the `x-network-name` header value against the network_type enum.
 * Used by routes that mount `requireNetwork`.
 */
export const networkNameHeaderValue = networkTypeEnum;

/**
 * Header schema requiring `x-network-name`.
 *
 * Loose object: validates `x-network-name`, ignores all other headers.
 */
export const requireNetworkHeader = z.looseObject({
  'x-network-name': networkNameHeaderValue,
});

/**
 * Header schema with optional `x-network-name`.
 *
 * Loose object: validates the header if present, ignores it if absent.
 */
export const optionalNetworkHeader = z.looseObject({
  'x-network-name': networkNameHeaderValue.optional(),
});

/**
 * Authorization header value: `Bearer <token>`.
 * Token format is not validated here (express-jwt handles JWT structure).
 */
export const bearerAuthValue = z
  .string()
  .regex(/^Bearer\s+\S+$/, 'Authorization header must be "Bearer <token>"');

/**
 * Header schema requiring a Bearer authorization header.
 */
export const requireAuthHeader = z.looseObject({
  authorization: bearerAuthValue,
});

/**
 * Header schema with optional Bearer authorization (for endpoints that work
 * both authenticated and anonymously).
 */
export const optionalAuthHeader = z.looseObject({
  authorization: bearerAuthValue.optional(),
});
