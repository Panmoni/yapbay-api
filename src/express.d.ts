import type { JwtPayload } from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      /** Unique correlation ID set by requestIdMiddleware. */
      requestId?: string;
      user?: JwtPayload; // Optional because it's only set after middleware
    }
  }
}
