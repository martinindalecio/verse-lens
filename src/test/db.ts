import { describe } from "vitest";

/** True when a test database is configured. */
export const hasTestDb = Boolean(process.env.DATABASE_URL_TEST);

/**
 * Like `describe`, but skipped cleanly when DATABASE_URL_TEST is unset.
 * Tests inside should point the app at the test DB (set DATABASE_URL from DATABASE_URL_TEST).
 */
export const describeDb = hasTestDb ? describe : describe.skip;
