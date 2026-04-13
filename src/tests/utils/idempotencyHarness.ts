// Thin Express harness for idempotency integration tests.
//
// Spins up a minimal app with the idempotency middleware mounted on a
// counter-backed POST handler. Each handler invocation bumps a counter on
// the test harness; tests assert "counter incremented exactly once per
// committed logical request" — the hard guarantee the middleware is
// supposed to provide under concurrent retries.

import express, { type Request, type Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';

export interface HarnessState {
  /** Hook invoked at the top of the handler — useful for delay injection. */
  beforeResponse?: () => Promise<void>;
  /** Number of times the underlying handler body actually ran. */
  executions: number;
  /** Override the response body. */
  responseBody: unknown;
  /** Override the response status (default 200). */
  responseStatus: number;
}

export function createIdempotencyApp(
  state: HarnessState,
  // Simulated authenticated user. Passing null makes the request
  // "anonymous" — tests the anon namespace path.
  user: { sub: string } | null = { sub: 'user-a' },
) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // Inject the simulated user before the idempotency middleware reads it.
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).user = user as AuthenticatedRequest['user'];
    next();
  });

  app.use('/mutation', idempotency());
  app.post('/mutation', async (_req: Request, res: Response) => {
    if (state.beforeResponse) {
      await state.beforeResponse();
    }
    state.executions++;
    res.status(state.responseStatus).json(state.responseBody);
  });

  return app;
}
