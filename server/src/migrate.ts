import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, type DbHandle } from './db.js';

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/**
 * Applies the drizzle-kit generated migrations in /drizzle. The API and the worker both migrate on
 * startup, so a session-level advisory lock serialises them: the second process waits, then finds
 * nothing left to apply.
 */
export async function migrate({ pool, db }: DbHandle): Promise<void> {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(424242)');
    await drizzleMigrate(db, { migrationsFolder });
  } finally {
    await lock.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    lock.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const handle = createDb();
  migrate(handle)
    .then(async () => {
      const { rows } = await handle.db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
      console.log(`Migrations up to date (${rows[0].n} applied)`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => handle.pool.end());
}
