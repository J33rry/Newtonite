import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { config } from './config.js';
import * as schema from './db/schema.js';

// Return bigint columns (item numbers, event ids) as JS numbers; they stay well below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle, as passed to the callback of `db.transaction()`. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything queries can run on: the pooled database or an open transaction. */
export type Executor = Database | Tx;

export interface DbHandle {
  /** Drizzle instance used by all application queries. */
  db: Database;
  /** Underlying pool (for shutdown, and for tests that verify state with raw SQL). */
  pool: pg.Pool;
}

export function createDb(connectionString = config.databaseUrl): DbHandle {
  const pool = new pg.Pool({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 20) });
  return { pool, db: drizzle(pool, { schema }) };
}

export { schema };
