import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';
import { createDb } from './db.js';
import { handlers } from './jobs/handlers.js';
import { enqueue } from './jobs/queue.js';
import { JobRunner } from './jobs/runner.js';
import { migrate } from './migrate.js';

/**
 * Background worker. Run as many copies as you like: job claiming uses SKIP LOCKED and the minute
 * sweep is deduplicated by key, so extra workers add throughput without duplicating work.
 */
const handle = createDb();
const { db } = handle;
await migrate(handle);
const runner = new JobRunner(db, handlers, config.worker);
console.log(`${runner.workerId} started`);

let running = true;
process.on('SIGINT', () => (running = false));
process.on('SIGTERM', () => (running = false));

let lastHousekeeping = 0;
while (running) {
  try {
    if (Date.now() - lastHousekeeping > 30_000) {
      lastHousekeeping = Date.now();
      const minute = new Date().toISOString().slice(0, 16);
      await enqueue(db, 'sweep', {}, { dedupeKey: `sweep:${minute}`, maxAttempts: 1 });
      const reaped = await runner.reapStuck();
      if (reaped) console.warn(`re-queued ${reaped} stuck job(s)`);
    }
    const processed = await runner.tick();
    if (!processed) await sleep(config.worker.pollIntervalMs);
  } catch (err) {
    // Database unavailable etc.: back off and keep going rather than crash-looping.
    console.error('worker loop error', err);
    await sleep(5000);
  }
}
await handle.pool.end();
console.log(`${runner.workerId} stopped`);
