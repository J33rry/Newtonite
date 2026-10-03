import pg from 'pg';
import { config } from './config.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

/**
 * Prepares a fresh, small database for the Playwright suite (see e2e/): creates it if missing,
 * drops everything, migrates and seeds. Because it is destructive it refuses to run against any
 * database whose name does not end in `_e2e`.
 */
const url = new URL(config.databaseUrl);
const name = url.pathname.slice(1);
if (!/^\w+_e2e$/.test(name)) {
  console.error(`Refusing to reset "${name}": the e2e database name must end in _e2e`);
  process.exit(1);
}

const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
await admin.connect();
const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
if (!rowCount) await admin.query(`CREATE DATABASE "${name}"`);
await admin.end();

const handle = createDb(config.databaseUrl);
await handle.pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await migrate(handle);
const items = Number(process.env.SEED_ITEMS ?? 500);
await seed(handle, items);
await handle.pool.end();
console.log(`e2e database "${name}" ready (${items} items)`);
