import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createItem, createTeam, createUser, resetData, setupApp, type TestCtx, type TestUser } from './helpers.js';

/**
 * The behaviours most dangerous to get wrong: two owners for one item, lost updates, and
 * duplicated actions from retries. These run real concurrent requests against Postgres.
 */
let ctx: TestCtx;
let team: string;
let lead: TestUser;
let members: TestUser[];

beforeEach(async () => {
  ctx ??= await setupApp();
  await resetData(ctx.db);
  team = await createTeam(ctx.db, 'Payments');
  lead = await createUser(ctx.db, 'Lead', [[team, 'lead']]);
  members = await Promise.all(Array.from({ length: 8 }, (_, i) => createUser(ctx.db, `Member${i}`, [[team, 'member']])));
});

afterAll(async () => {
  await ctx?.app.close();
  await ctx?.db.end();
});

const events = async (itemId: string, type: string) =>
  (await ctx.db.query('SELECT * FROM item_events WHERE item_id = $1 AND type = $2', [itemId, type])).rows;

describe('claiming the same item concurrently', () => {
  it('gives the item to exactly one person and tells the others who won', async () => {
    const item = await createItem(ctx.app, lead, team);
    const results = await Promise.all(members.map((m) => api(ctx.app, m).post(`/api/items/${item.id}/claim`)));

    const winners = results.filter((r) => r.statusCode === 200);
    const losers = results.filter((r) => r.statusCode === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(members.length - 1);

    const winner = winners[0].json();
    for (const l of losers) {
      expect(l.json().error.code).toBe('ALREADY_CLAIMED');
      expect(l.json().error.details.assigneeId).toBe(winner.assignee_id);
    }
    // Exactly one ownership event in the history, and the item is in progress once.
    expect(await events(item.id, 'assigned')).toHaveLength(1);
    expect(winner.status).toBe('in_progress');
    expect(winner.version).toBe(2);
  });

  it('treats a repeated claim by the current owner as success without new history', async () => {
    const item = await createItem(ctx.app, lead, team);
    const first = await api(ctx.app, members[0]).post(`/api/items/${item.id}/claim`);
    const again = await api(ctx.app, members[0]).post(`/api/items/${item.id}/claim`);
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(await events(item.id, 'assigned')).toHaveLength(1);
  });
});

describe('stale updates (optimistic concurrency)', () => {
  it('rejects an edit based on an outdated version instead of silently overwriting', async () => {
    const item = await createItem(ctx.app, lead, team);
    const a = await api(ctx.app, lead).patch(`/api/items/${item.id}`, { expectedVersion: 1, title: 'Edited by A' });
    const b = await api(ctx.app, lead).patch(`/api/items/${item.id}`, { expectedVersion: 1, title: 'Edited by B' });

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(409);
    expect(b.json().error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });
    const current = await api(ctx.app, lead).get(`/api/items/${item.id}`);
    expect(current.json().title).toBe('Edited by A');
  });

  it('serialises a burst of concurrent edits: one wins per version, none are lost silently', async () => {
    const item = await createItem(ctx.app, lead, team);
    const burst = await Promise.all(
      Array.from({ length: 10 }, (_, i) => api(ctx.app, lead).patch(`/api/items/${item.id}`, { expectedVersion: 1, description: `edit ${i}` })),
    );
    expect(burst.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(burst.filter((r) => r.statusCode === 409)).toHaveLength(9);
    const row = (await ctx.db.query('SELECT version FROM work_items WHERE id = $1', [item.id])).rows[0];
    expect(row.version).toBe(2);
    expect(await events(item.id, 'updated')).toHaveLength(1);
  });

  it('applies workflow rules to the latest state: two people resolving at once', async () => {
    const item = await createItem(ctx.app, lead, team, { type: 'task' });
    const claimed = (await api(ctx.app, members[0]).post(`/api/items/${item.id}/claim`)).json();
    const [r1, r2] = await Promise.all([
      api(ctx.app, members[0]).post(`/api/items/${item.id}/transition`, { expectedVersion: claimed.version, action: 'resolve' }),
      api(ctx.app, lead).post(`/api/items/${item.id}/transition`, { expectedVersion: claimed.version, action: 'resolve' }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect(await events(item.id, 'status_changed')).toHaveLength(1);
  });

  it('does not count comments as conflicting edits', async () => {
    const item = await createItem(ctx.app, lead, team);
    await api(ctx.app, members[0]).post(`/api/items/${item.id}/comments`, { body: 'Looking at the logs' });
    const edit = await api(ctx.app, lead).patch(`/api/items/${item.id}`, { expectedVersion: 1, priority: 1 });
    expect(edit.statusCode).toBe(200);
  });
});

describe('idempotent retries', () => {
  it('replays the original result when the same request is retried', async () => {
    const headers = { 'idempotency-key': 'create-123456' };
    const body = { teamId: team, title: 'Refund', type: 'payment', priority: 2 };
    const first = await api(ctx.app, lead).post('/api/items', body, headers);
    const retry = await api(ctx.app, lead).post('/api/items', body, headers);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json().id).toBe(first.json().id);
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM work_items')).rows[0].n).toBe(1);
  });

  it('executes once when duplicates arrive concurrently (double click)', async () => {
    const item = await createItem(ctx.app, lead, team);
    const headers = { 'idempotency-key': 'comment-abcdef' };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api(ctx.app, members[0]).post(`/api/items/${item.id}/comments`, { body: 'On it' }, headers)),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
    expect(await events(item.id, 'commented')).toHaveLength(1);
  });

  it('rejects reuse of a key for a different request', async () => {
    const item = await createItem(ctx.app, lead, team);
    const headers = { 'idempotency-key': 'comment-reused' };
    await api(ctx.app, members[0]).post(`/api/items/${item.id}/comments`, { body: 'one' }, headers);
    const other = await api(ctx.app, members[0]).post(`/api/items/${item.id}/comments`, { body: 'two' }, headers);
    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('lets a retry execute if the first attempt failed', async () => {
    const item = await createItem(ctx.app, lead, team);
    const headers = { 'idempotency-key': 'transition-retry' };
    const body = { expectedVersion: 1, action: 'block', reason: 'waiting on bank' };
    const failed = await api(ctx.app, lead).post(`/api/items/${item.id}/transition`, body, headers); // open -> block is invalid
    expect(failed.statusCode).toBe(409);
    const stored = await ctx.db.query('SELECT 1 FROM idempotency_keys WHERE key = $1', ['transition-retry']);
    expect(stored.rowCount).toBe(0);
  });
});
