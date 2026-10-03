import type { Executor } from '../db.js';
import { jobs } from '../db/schema.js';

export type JobType = (typeof jobs.$inferInsert)['type'];

/**
 * Enqueue a job. Called inside the same transaction as the change that caused it (transactional
 * outbox): if the change rolls back, the job never exists; if it commits, the job is durable.
 * `dedupeKey` makes enqueueing idempotent — the same logical job can only be queued once.
 */
export async function enqueue(
  db: Executor,
  type: JobType,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {},
): Promise<void> {
  await db
    .insert(jobs)
    .values({
      type,
      payload,
      dedupe_key: opts.dedupeKey ?? null,
      ...(opts.runAt ? { run_at: opts.runAt } : {}),
      ...(opts.maxAttempts ? { max_attempts: opts.maxAttempts } : {}),
    })
    .onConflictDoNothing({ target: jobs.dedupe_key });
}
