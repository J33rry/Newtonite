import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Database, Tx } from '../db.js';
import { jobs } from '../db/schema.js';
import type { JobType } from './queue.js';

export interface Job {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/**
 * A handler does its work inside `tx`; the job is marked done in that same transaction. So database
 * side effects and completion commit atomically. External side effects (none today) would need to
 * be idempotent, because delivery is at-least-once: a crash after the work but before commit means
 * the job runs again.
 */
export type Handler = (tx: Tx, job: Job) => Promise<void>;
export type Handlers = Record<JobType, Handler>;

/** Exponential backoff with a cap: 2s, 4s, 8s, … up to 5 minutes. */
export function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 1000, 5 * 60_000);
}

export class JobRunner {
  readonly workerId = `worker-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly db: Database,
    private readonly handlers: Handlers,
    private readonly opts: { batchSize: number; lockTimeoutMs: number },
  ) {}

  /**
   * Claims ready jobs. FOR UPDATE SKIP LOCKED lets any number of workers poll the same table without
   * blocking each other or picking the same job. The claim commits immediately (status=running), so
   * a slow job does not hold a row lock and its progress is visible.
   */
  async claim(): Promise<Job[]> {
    const ready = this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, 'pending'), lte(jobs.run_at, sql`now()`)))
      .orderBy(asc(jobs.run_at), asc(jobs.id))
      .limit(this.opts.batchSize)
      .for('update', { skipLocked: true });
    return this.db
      .update(jobs)
      .set({ status: 'running', attempts: sql`${jobs.attempts} + 1`, locked_at: sql`now()`, locked_by: this.workerId, updated_at: sql`now()` })
      .where(inArray(jobs.id, ready))
      .returning({ id: jobs.id, type: jobs.type, payload: jobs.payload, attempts: jobs.attempts, max_attempts: jobs.max_attempts });
  }

  async process(job: Job): Promise<'done' | 'retry' | 'dead' | 'lost'> {
    const handler = this.handlers[job.type];
    const mine = and(eq(jobs.id, job.id), eq(jobs.locked_by, this.workerId));
    try {
      return await this.db.transaction(async (tx) => {
        if (!handler) throw new Error(`No handler for job type ${job.type}`);
        await handler(tx, job);
        const done = await tx
          .update(jobs)
          .set({ status: 'done', locked_at: null, last_error: null, updated_at: sql`now()` })
          .where(and(mine, eq(jobs.status, 'running')))
          .returning({ id: jobs.id });
        // If the reaper handed this job to another worker (we were too slow), roll our work back.
        if (!done.length) throw new LostLeaseError();
        return 'done' as const;
      });
    } catch (err) {
      if (err instanceof LostLeaseError) return 'lost';
      const dead = job.attempts >= job.max_attempts;
      await this.db
        .update(jobs)
        .set({
          status: dead ? 'dead' : 'pending',
          run_at: sql`now() + make_interval(secs => ${backoffMs(job.attempts) / 1000})`,
          last_error: String((err as Error)?.stack ?? err).slice(0, 4000),
          locked_at: null,
          locked_by: null,
          updated_at: sql`now()`,
        })
        .where(mine);
      return dead ? 'dead' : 'retry';
    }
  }

  /** Jobs stuck in 'running' belong to a crashed or hung worker; make them eligible again. */
  async reapStuck(): Promise<number> {
    const reaped = await this.db
      .update(jobs)
      .set({
        status: 'pending',
        locked_at: null,
        locked_by: null,
        updated_at: sql`now()`,
        last_error: sql`coalesce(${jobs.last_error}, '') || ' [lease expired]'`,
      })
      .where(and(eq(jobs.status, 'running'), lt(jobs.locked_at, sql`now() - make_interval(secs => ${this.opts.lockTimeoutMs / 1000})`)))
      .returning({ id: jobs.id });
    return reaped.length;
  }

  /** Runs one polling cycle; returns how many jobs were processed. */
  async tick(): Promise<number> {
    const claimed = await this.claim();
    for (const job of claimed) await this.process(job);
    return claimed.length;
  }
}

class LostLeaseError extends Error {}
