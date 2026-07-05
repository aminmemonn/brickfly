import { Pool } from '@neondatabase/serverless';

/**
 * A shared Postgres pool for the Auth.js adapter and game-state API.
 * Returns null when DATABASE_URL is unset so the app still builds/runs
 * without a database configured (accounts simply stay disabled).
 */
const url = process.env.DATABASE_URL;

export const pool = url ? new Pool({ connectionString: url }) : null;

/** True when the account system has everything it needs to actually work. */
export const authConfigured = !!(
  url &&
  process.env.AUTH_SECRET &&
  (process.env.AUTH_GOOGLE_ID || process.env.AUTH_GITHUB_ID)
);
