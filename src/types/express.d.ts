import { NetworkConfig } from './networks';

declare global {
  namespace Express {
    interface Request {
      network?: NetworkConfig;
      networkId?: number;
    }
  }
}

export {};