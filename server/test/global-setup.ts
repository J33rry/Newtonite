import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

/** Recreates the test schema from the drizzle-kit migrations once per test run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://ops:ops@localhost:5433/ops_test';
  const handle = createDb(url);
  // Drizzle records applied migrations in the "drizzle" schema, so reset that too.
  await handle.pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(handle);
  await handle.pool.end();
}
