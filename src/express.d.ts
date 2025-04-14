import { JwtPayload } from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload; // Optional because it's only set after middleware
    }
  }
}

export {};
