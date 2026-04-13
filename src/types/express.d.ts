/**
 * DO NOT add `import` or `export` statements to this file.
 *
 * It must remain an ambient declaration (no top-level imports/exports) so
 * TypeScript merges it into the global namespace automatically and ts-node
 * under mocha picks it up without an explicit import. Adding a module-level
 * import or export turns this into a module, which silently breaks
 * `req.requestId` and `req.network` type resolution in test runs.
 *
 * Reference types via `import('<path>').Type` inline (type-only) instead.
 */

declare namespace Express {
  interface Request {
    network?: import('./networks').NetworkConfig;
    networkId?: number;
    requestId?: string;
  }
}
