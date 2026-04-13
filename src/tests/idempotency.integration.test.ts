// Integration tests for the idempotency middleware.
//
// Requires a live Postgres (migrations 0035 + 0036 applied) — run via
// `pnpm test:integration` against the docker-compose.test.yml fixture.
// These cannot be property-tested in isolation because the middleware's
// correctness hinges on pg advisory locks and partial-unique indexes that
// only exist in the real schema.

import { randomUUID } from 'node:crypto';
import { expect } from 'chai';
import request from 'supertest';
import { query } from '../db';
import { createIdempotencyApp, type HarnessState } from './utils/idempotencyHarness';

function freshState(overrides: Partial<HarnessState> = {}): HarnessState {
  return {
    executions: 0,
    responseStatus: 200,
    responseBody: { ok: true, id: randomUUID() },
    ...overrides,
  };
}

async function purge(): Promise<void> {
  await query('DELETE FROM idempotency_records');
}

describe('idempotency middleware (integration)', function integration() {
  // 10 s per test — most are ~100 ms, but the advisory-lock concurrency
  // test serializes two in-flight requests.
  this.timeout(10_000);

  beforeEach(async () => {
    await purge();
  });

  it('stores the response on first call', async () => {
    const state = freshState();
    const app = createIdempotencyApp(state);
    const key = randomUUID();

    const res = await request(app)
      .post('/mutation')
      .set('Idempotency-Key', key)
      .send({ amount: '1.000000' });

    expect(res.status).to.equal(200);
    expect(state.executions).to.equal(1);

    const rows = await query(
      'SELECT response_status, user_sub FROM idempotency_records WHERE key = $1',
      [key],
    );
    expect(rows).to.have.lengthOf(1);
    expect(rows[0].response_status).to.equal(200);
    expect(rows[0].user_sub).to.equal('user-a');
  });

  it('replays the cached response on same key + same body', async () => {
    const state = freshState();
    const app = createIdempotencyApp(state);
    const key = randomUUID();
    const body = { amount: '1.500000', target: '0xabc' };

    const first = await request(app).post('/mutation').set('Idempotency-Key', key).send(body);
    const second = await request(app).post('/mutation').set('Idempotency-Key', key).send(body);

    expect(first.status).to.equal(200);
    expect(second.status).to.equal(200);
    expect(second.headers['idempotent-replayed']).to.equal('true');
    expect(second.body).to.deep.equal(first.body);
    // Handler ran exactly once.
    expect(state.executions).to.equal(1);
  });

  it('returns 409 on same key + different body (conflict)', async () => {
    const state = freshState();
    const app = createIdempotencyApp(state);
    const key = randomUUID();

    await request(app).post('/mutation').set('Idempotency-Key', key).send({ amount: '1' });
    const second = await request(app)
      .post('/mutation')
      .set('Idempotency-Key', key)
      .send({ amount: '2' });

    expect(second.status).to.equal(409);
    expect(second.body.error).to.equal('idempotency_key_conflict');
    expect(state.executions).to.equal(1);
  });

  it('canonicalizes body key order (same logical body = cache hit)', async () => {
    const state = freshState();
    const app = createIdempotencyApp(state);
    const key = randomUUID();

    await request(app)
      .post('/mutation')
      .set('Idempotency-Key', key)
      .send({ amount: '1', target: '0xabc' });
    const second = await request(app)
      .post('/mutation')
      .set('Idempotency-Key', key)
      .send({ target: '0xabc', amount: '1' });

    expect(second.status).to.equal(200);
    expect(second.headers['idempotent-replayed']).to.equal('true');
    expect(state.executions).to.equal(1);
  });

  it('scopes cache to user_sub — different user same key = cache miss', async () => {
    const state = freshState();
    const appA = createIdempotencyApp(state, { sub: 'user-a' });
    const appB = createIdempotencyApp(state, { sub: 'user-b' });
    const key = randomUUID();
    const body = { amount: '1' };

    await request(appA).post('/mutation').set('Idempotency-Key', key).send(body);
    await request(appB).post('/mutation').set('Idempotency-Key', key).send(body);

    // Each user executed once; no cross-tenant leak.
    expect(state.executions).to.equal(2);
    const rows = await query(
      'SELECT user_sub FROM idempotency_records WHERE key = $1 ORDER BY user_sub',
      [key],
    );
    expect(rows).to.have.lengthOf(2);
    expect(rows.map((r: { user_sub: string }) => r.user_sub)).to.deep.equal(['user-a', 'user-b']);
  });

  it('does not cache 4xx responses — client can retry with corrected body', async () => {
    const state = freshState({ responseStatus: 400, responseBody: { error: 'bad_input' } });
    const app = createIdempotencyApp(state);
    const key = randomUUID();

    const first = await request(app).post('/mutation').set('Idempotency-Key', key).send({ x: 1 });
    expect(first.status).to.equal(400);

    // Same key, SAME body — would be a 409 if the 400 were cached. Handler
    // runs again and still returns 400 because the state is fixed, but the
    // point is we don't conflate 400 with a committed response.
    const second = await request(app).post('/mutation').set('Idempotency-Key', key).send({ x: 1 });
    expect(second.status).to.equal(400);
    expect(second.headers['idempotent-replayed']).to.be.undefined;
    expect(state.executions).to.equal(2);
  });

  it('rejects malformed UUID keys with 400', async () => {
    const state = freshState();
    const app = createIdempotencyApp(state);

    const res = await request(app).post('/mutation').set('Idempotency-Key', 'not-a-uuid').send({});

    expect(res.status).to.equal(400);
    expect(res.body.error).to.equal('invalid_idempotency_key');
    expect(state.executions).to.equal(0);
  });

  it('is case-insensitive on the key value (lowercases before storage)', async () => {
    const state = freshState();
    const app = createIdempotencyApp(state);
    const key = randomUUID();
    const body = { amount: '1' };

    await request(app).post('/mutation').set('Idempotency-Key', key.toUpperCase()).send(body);
    const second = await request(app)
      .post('/mutation')
      .set('Idempotency-Key', key.toLowerCase())
      .send(body);

    expect(second.headers['idempotent-replayed']).to.equal('true');
    expect(state.executions).to.equal(1);
  });

  it('serializes concurrent same-key requests via advisory lock', async () => {
    // Simulate two concurrent first-time requests with the same key. Without
    // the lock, both would see cache miss + both would execute. With the
    // lock, exactly one executes and the other replays the committed row.
    let releaseFirst!: () => void;
    const firstInFlight = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let firstStarted = false;
    let signalFirstEntered!: () => void;
    const firstEntered = new Promise<void>((r) => {
      signalFirstEntered = r;
    });

    const state: HarnessState = {
      executions: 0,
      responseStatus: 200,
      responseBody: { ok: true },
      beforeResponse: async () => {
        if (!firstStarted) {
          firstStarted = true;
          // Signal that the first request has entered the handler body —
          // the idempotency middleware has already committed its advisory
          // lock at this point. The test uses this event (not a blind
          // setTimeout) to know when it's safe to dispatch the second
          // request, keeping the test deterministic on slow CI runners.
          signalFirstEntered();
          await firstInFlight;
        }
      },
    };
    const app = createIdempotencyApp(state);
    const key = randomUUID();
    const body = { amount: '1' };

    const req1 = request(app).post('/mutation').set('Idempotency-Key', key).send(body);

    // Wait for the event, not a fixed duration.
    await firstEntered;

    const req2Promise = request(app).post('/mutation').set('Idempotency-Key', key).send(body);

    // Small settle delay so req2 has a chance to enter the middleware +
    // block on the advisory lock before we release req1. 50ms is enough
    // for in-process Express + pg on any realistic runner. If this is
    // ever flaky, increase — but do NOT remove; a non-zero settle time
    // is what lets the test assert serialization vs. racing.
    await new Promise((r) => setTimeout(r, 50));

    // Let req1 finish. req2 should now see the committed row and replay.
    releaseFirst();

    const [res1, res2] = await Promise.all([req1, req2Promise]);
    expect(res1.status).to.equal(200);
    expect(res2.status).to.equal(200);
    // Exactly one execution despite concurrent requests.
    expect(state.executions).to.equal(1);
    // res2 is the replayed one.
    expect(res2.headers['idempotent-replayed']).to.equal('true');
  });

  it('passes through when no Idempotency-Key header is sent (permissive mode)', async () => {
    const state = freshState();
    const app = createIdempotencyApp(state);

    const res = await request(app).post('/mutation').send({ x: 1 });
    expect(res.status).to.equal(200);
    expect(state.executions).to.equal(1);

    const rows = await query('SELECT key FROM idempotency_records');
    expect(rows).to.have.lengthOf(0);
  });
});
