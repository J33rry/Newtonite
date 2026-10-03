import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';
import { createDb } from './db.js';
import { handlers } from './jobs/handlers.js';
import { enqueue } from './jobs/queue.js';
import { JobRunner } from './jobs/runner.js';
import { JobWakeup } from './jobs/wakeup.js';
import { migrate } from './migrate.js';

/**
 * Background worker. Run as many copies as you like: job claiming uses SKIP LOCKED and the minute
 * sweep is deduplicated by key, so extra workers add throughput without duplicating work.
 *
 * When idle, the worker sleeps until a job is enqueued (LISTEN/NOTIFY, see JobWakeup), the next
 * delayed retry is due, or housekeeping is due — instead of polling the jobs table every second.
 */
const HOUSEKEEPING_MS = 30_000;

const handle = createDb();
const { db } = handle;
await migrate(handle);
const runner = new JobRunner(db, handlers, config.worker);
const wakeup = new JobWakeup(config.databaseUrl);
await wakeup.start();
console.log(`${runner.workerId} started`);

let running = true;
const stop = () => {
  running = false;
  void wakeup.stop(); // interrupts an idle wait so shutdown is immediate
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

/** How long to sleep when the queue has nothing runnable right now. */
async function idleDelay(lastHousekeeping: number): Promise<number> {
  if (!wakeup.listening) return config.worker.pollIntervalMs; // can't hear enqueues: poll
  const untilHousekeeping = lastHousekeeping + HOUSEKEEPING_MS - Date.now();
  const next = await runner.nextRunAt();
  const untilNextJob = next ? next.getTime() - Date.now() : Infinity;
  // Small floor: a "due" job may be momentarily locked by another worker's claim; do not spin on it.
  return Math.max(50, Math.min(config.worker.maxIdleMs, untilHousekeeping, untilNextJob));
}

let lastHousekeeping = 0;
while (running) {
  try {
    if (Date.now() - lastHousekeeping >= HOUSEKEEPING_MS) {
      lastHousekeeping = Date.now();
      const minute = new Date().toISOString().slice(0, 16);
      await enqueue(db, 'sweep', {}, { dedupeKey: `sweep:${minute}`, maxAttempts: 1 });
      const reaped = await runner.reapStuck();
      if (reaped) console.warn(`re-queued ${reaped} stuck job(s)`);
    }
    const processed = await runner.tick();
    if (!processed && running) await wakeup.wait(await idleDelay(lastHousekeeping));
  } catch (err) {
    // Database unavailable etc.: back off and keep going rather than crash-looping.
    console.error('worker loop error', err);
    await sleep(5000);
  }
}
await wakeup.stop();
await handle.pool.end();
console.log(`${runner.workerId} stopped`);
