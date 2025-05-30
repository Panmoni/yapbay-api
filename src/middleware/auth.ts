import { Request as ExpressRequest, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { CustomJwtPayload } from '../utils/jwtUtils';
import { NetworkConfig } from '../types/networks';

// Extend Express Request interface to use existing NetworkConfig
export interface AuthenticatedRequest extends ExpressRequest {
  user?: CustomJwtPayload;
  networkId?: number;
  network?: NetworkConfig;
  validatedOffer?: Record<string, unknown>;
  validatedBuyerAccount?: Record<string, unknown>;
  validatedCreatorAccount?: Record<string, unknown>;
  tradeData?: Record<string, unknown>;
  escrowData?: Record<string, unknown>;
}

// JWT Verification Setup
const client = jwksClient({
  jwksUri:
    'https://app.dynamic.xyz/api/v0/sdk/322e23a8-06d7-445f-b525-66426d63d858/.well-known/jwks',
  rateLimit: true,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000, // 10 minutes
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
    } else {
      const signingKey = key?.getPublicKey();
      callback(null, signingKey);
    }
  });
}

// Secure JWT Verification Middleware
export const requireJWT = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }
  const decodedHeader = jwt.decode(token, { complete: true });
  if (!decodedHeader || typeof decodedHeader === 'string') {
    res.status(401).json({ error: 'Invalid token format' });
    return;
  }
  const alg = decodedHeader.header.alg;
  const verifier =
    alg === 'HS256'
      ? (cb: jwt.VerifyCallback) =>
          jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }, cb)
      : (cb: jwt.VerifyCallback) => jwt.verify(token, getKey, { algorithms: ['RS256'] }, cb);
  verifier((err, decoded) => {
    if (err) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    req.user = decoded as CustomJwtPayload;
    next();
  });
};

// Admin-only guard
export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};