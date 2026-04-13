// OpenAPI registration for auth routes.

import { z } from 'zod';
import { openApiRegistry } from '../../openapi';
import { ErrorResponse } from './shared';

const adminLoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const adminLoginResponse = z.object({
  token: z.string(),
  expiresIn: z.number().int().positive(),
});

const AdminLoginRequest = openApiRegistry.register('AdminLoginRequest', adminLoginRequest);
const AdminLoginResponse = openApiRegistry.register('AdminLoginResponse', adminLoginResponse);

openApiRegistry.registerPath({
  method: 'post',
  path: '/admin/login',
  summary: 'Admin login',
  description:
    'Exchange admin credentials for a short-lived JWT. Rate-limited to 5 attempts per 15 minutes per IP. Not for regular users — issue JWTs via Dynamic.xyz.',
  tags: ['Auth'],
  request: {
    body: {
      content: { 'application/json': { schema: AdminLoginRequest } },
    },
  },
  responses: {
    200: {
      description: 'Authenticated',
      content: { 'application/json': { schema: AdminLoginResponse } },
    },
    401: {
      description: 'Invalid credentials',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    429: {
      description: 'Rate limit exceeded',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
