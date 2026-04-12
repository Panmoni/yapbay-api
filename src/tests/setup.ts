import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Test-database safeguard.
 *
 * Refuses to run the suite unless POSTGRES_URL points at a database whose name
 * ends in `_test` (or the explicit `YAPBAY_TEST_DB_OVERRIDE=1` escape hatch is
 * set). Also bails outright if NODE_ENV is "production" or the URL host
 * matches a prod host blocklist.
 *
 * Uses Mocha's root hooks plugin pattern (exported `mochaHooks`) so it runs
 * inside the Mocha lifecycle. A bare `before()` call at the top level throws
 * at require-time because Mocha globals aren't defined yet.
 *
 * Registered via .mocharc.json so every `npm test*` invocation runs it before
 * any test body executes.
 */
export const mochaHooks = {
  beforeAll() {
    const url = process.env.POSTGRES_URL;
    if (!url) {
      throw new Error(
        '[test-guard] POSTGRES_URL is not set. Refusing to run tests without an explicit test DB.',
      );
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error('[test-guard] NODE_ENV=production. Refusing to run tests.');
    }

    const override = process.env.YAPBAY_TEST_DB_OVERRIDE === '1';

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('[test-guard] POSTGRES_URL is not a parseable URL.');
    }

    const prodHostBlocklist = (process.env.YAPBAY_PROD_DB_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    if (prodHostBlocklist.includes(parsed.hostname)) {
      throw new Error(
        `[test-guard] POSTGRES_URL host "${parsed.hostname}" is listed in YAPBAY_PROD_DB_HOSTS. Refusing to run tests.`,
      );
    }

    const dbName = parsed.pathname.replace(/^\//, '');
    if (!/_test$/.test(dbName)) {
      if (override) {
        console.warn(
          `[test-guard] WARNING: DB name "${dbName}" does not end in _test but YAPBAY_TEST_DB_OVERRIDE=1. Proceeding anyway.`,
        );
      } else {
        throw new Error(
          `[test-guard] DB name "${dbName}" does not end in _test. Set YAPBAY_TEST_DB_OVERRIDE=1 to bypass (discouraged).`,
        );
      }
    }

    console.log(`[test-guard] OK — tests will run against DB "${dbName}" on ${parsed.hostname}.`);
  },
};
