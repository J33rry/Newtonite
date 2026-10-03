import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { notifications as notificationsTable } from '../src/db/schema.js';
import { handlers } from '../src/jobs/handlers.js';
import { enqueue } from '../src/jobs/queue.js';
import { JobRunner, type Handlers } from '../src/jobs/runner.js';
import { api, createItem, createTeam, createUser, resetData, setupApp, type TestCtx, type TestUser } from './helpers.js';

/** Async processing must survive failures, duplicates and crashes without losing or doubling work. */
let ctx: TestCtx;
let team: string;
let lead: TestUser;
let member: TestUser;

const opts = { batchSize: 50, lockTimeoutMs: 60_000 };
const jobs = async () => (await ctx.db.query('SELECT * FROM jobs ORDER BY id')).rows;
const notifications = async (userId: string) =>
  (await ctx.db.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY id', [userId])).rows;

beforeEach(async () => {
  ctx ??= await setupApp();
  await resetData(ctx.db);
  team = await createTeam(ctx.db, 'Payments');
  lead = await createUser(ctx.db, 'Lead', [[team, 'lead']]);
  member = await createUser(ctx.db, 'Member', [[team, 'member']]);
});

afterAll(async () => {
  await ctx?.app.close();
  await ctx?.db.end();
});

describe('transactional outbox', () => {
  it('enqueues a notification job in the same transaction as the change', async () => {
    const item = await createItem(ctx.app, member, team);
    await api(ctx.app, lead).post(`/api/items/${item.id}/comments`, { body: 'Please check the ledger' });
    const queued = (await jobs()).filter((j) => j.type === 'notify_event');
    expect(queued).toHaveLength(2); // created + commented
  });

  it('creates no job when the change rolls back', async () => {
    const item = await createItem(ctx.app, member, team);
    const before = (await jobs()).length;
    const conflict = await api(ctx.app, lead).patch(`/api/items/${item.id}`, { expectedVersion: 99, title: 'x' });
    expect(conflict.statusCode).toBe(409);
    expect((await jobs()).length).toBe(before);
  });
});

describe('job processing', () => {
  it('delivers each notification once even if the job runs twice', async () => {
    const item = await createItem(ctx.app, member, team);
    await api(ctx.app, lead).post(`/api/items/${item.id}/comments`, { body: 'Ping' });
    const runner = new JobRunner(ctx.orm, handlers, opts);
    await runner.tick();
    expect(await notifications(member.id)).toHaveLength(1);

    // Simulate at-least-once redelivery: put every job back to pending and run again.
    await ctx.db.query(`UPDATE jobs SET status = 'pending', locked_by = NULL`);
    await runner.tick();
    expect(await notifications(member.id)).toHaveLength(1);
  });

  it('does not notify people about their own actions', async () => {
    const item = await createItem(ctx.app, member, team);
    await api(ctx.app, member).post(`/api/items/${item.id}/comments`, { body: 'note to self' });
    await new JobRunner(ctx.orm, handlers, opts).tick();
    expect(await notifications(member.id)).toHaveLength(0);
  });

  it('notifies team leads when approval is requested', async () => {
    const item = await createItem(ctx.app, member, team, { requiresApproval: true });
    await api(ctx.app, member).post(`/api/items/${item.id}/transition`, { expectedVersion: 1, action: 'submit_for_approval' });
    await new JobRunner(ctx.orm, handlers, opts).tick();
    const kinds = (await notifications(lead.id)).map((n) => n.kind);
    expect(kinds).toContain('approval_requested');
  });

  it('retries failures with backoff, then dead-letters, keeping the error', async () => {
    await enqueue(ctx.orm, 'sweep', {}, { maxAttempts: 2 });
    const failing: Handlers = { ...handlers, sweep: async () => { throw new Error('enrichment service down'); } };
    const runner = new JobRunner(ctx.orm, failing, opts);

    await runner.tick();
    let [job] = await jobs();
    expect(job).toMatchObject({ status: 'pending', attempts: 1 });
    expect(job.last_error).toContain('enrichment service down');
    expect(new Date(job.run_at).getTime()).toBeGreaterThan(Date.now()); // backed off

    await ctx.db.query('UPDATE jobs SET run_at = now()');
    await runner.tick();
    [job] = await jobs();
    expect(job).toMatchObject({ status: 'dead', attempts: 2 });
  });

  it('rolls back a handler’s partial work when it fails', async () => {
    await enqueue(ctx.orm, 'sweep', {});
    const partial: Handlers = {
      ...handlers,
      sweep: async (tx) => {
        await tx.insert(notificationsTable).values({ user_id: member.id, kind: 'x', message: 'partial', dedupe_key: 'p' });
        throw new Error('boom');
      },
    };
    await new JobRunner(ctx.orm, partial, opts).tick();
    expect(await notifications(member.id)).toHaveLength(0);
  });

  it('never hands the same job to two concurrent workers', async () => {
    for (let i = 0; i < 40; i++) await enqueue(ctx.orm, 'sweep', { i });
    const seen: number[] = [];
    const recording: Handlers = { ...handlers, sweep: async (_tx, job) => { seen.push(job.id); } };
    const workers = Array.from({ length: 4 }, () => new JobRunner(ctx.orm, recording, { ...opts, batchSize: 5 }));
    // Drain the queue with 4 workers polling simultaneously.
    for (let round = 0; round < 10; round++) await Promise.all(workers.map((w) => w.tick()));
    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
  });

  it('recovers jobs abandoned by a crashed worker, and the slow worker cannot complete them', async () => {
    await enqueue(ctx.orm, 'sweep', {});
    const crashed = new JobRunner(ctx.orm, handlers, opts);
    const [job] = await crashed.claim(); // claimed, then the worker "dies"
    await ctx.db.query(`UPDATE jobs SET locked_at = now() - interval '10 minutes'`);

    const healthy = new JobRunner(ctx.orm, handlers, opts);
    expect(await healthy.reapStuck()).toBe(1);
    expect(await healthy.tick()).toBe(1);
    expect((await jobs())[0]).toMatchObject({ status: 'done', locked_by: healthy.workerId });

    // If the "crashed" worker wakes up and finishes, it must not mark the job done again.
    expect(await crashed.process(job)).toBe('lost');
  });

  it('deduplicates the periodic sweep across workers', async () => {
    await ctx.orm.transaction(async (tx) => {
      await enqueue(tx, 'sweep', {}, { dedupeKey: 'sweep:2026-10-03T10:00' });
      await enqueue(tx, 'sweep', {}, { dedupeKey: 'sweep:2026-10-03T10:00' });
    });
    expect(await jobs()).toHaveLength(1);
  });

  it('alerts once per due date for overdue items', async () => {
    const item = await createItem(ctx.app, member, team, { dueAt: new Date(Date.now() - 3600_000).toISOString() });
    await api(ctx.app, member).post(`/api/items/${item.id}/claim`);
    await ctx.db.query('DELETE FROM jobs');
    const runner = new JobRunner(ctx.orm, handlers, opts);
    await enqueue(ctx.orm, 'sweep', {});
    await runner.tick();
    await enqueue(ctx.orm, 'sweep', {});
    await runner.tick();
    expect((await notifications(member.id)).filter((n) => n.kind === 'overdue')).toHaveLength(1);
  });
});
