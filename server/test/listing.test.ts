import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toPrefixTsQuery } from '../src/services/listing.js';
import { api, createTeam, createUser, resetData, setupApp, type TestCtx, type TestUser } from './helpers.js';

/** Paging must stay correct (no duplicates, no gaps) with many rows sharing the same sort keys. */
let ctx: TestCtx;
let team: string;
let lead: TestUser;

beforeAll(async () => {
  ctx = await setupApp();
  await resetData(ctx.db);
  team = await createTeam(ctx.db, 'Ops');
  lead = await createUser(ctx.db, 'Lead', [[team, 'lead']]);
  // 230 items with heavy ties: 4 priorities, and batches sharing identical updated_at timestamps.
  await ctx.db.query(
    `INSERT INTO work_items (team_id, title, type, priority, status, created_by, updated_at)
     SELECT $1, 'Item ' || g, 'task', 1 + (g % 4), 'open', $2, timestamp '2026-01-01' + ((g / 10) || ' minutes')::interval
       FROM generate_series(1, 230) g`,
    [team, lead.id],
  );
});

afterAll(async () => {
  await ctx?.app.close();
  await ctx?.db.end();
});

async function collect(sort: string) {
  const ids: string[] = [];
  const priorities: number[] = [];
  let cursor: string | null = null;
  do {
    const res = await api(ctx.app, lead).get(`/api/items?sort=${sort}&limit=25${cursor ? `&cursor=${cursor}` : ''}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    ids.push(...body.items.map((i: { id: string }) => i.id));
    priorities.push(...body.items.map((i: { priority: number }) => i.priority));
    cursor = body.nextCursor;
  } while (cursor);
  return { ids, priorities };
}

describe('keyset pagination', () => {
  it.each(['priority', 'recent'])('returns every item exactly once when sorted by %s', async (sort) => {
    const { ids, priorities } = await collect(sort);
    expect(ids).toHaveLength(230);
    expect(new Set(ids).size).toBe(230);
    if (sort === 'priority') expect([...priorities].sort()).toEqual(priorities);
  });

  it('rejects a tampered cursor with a 400', async () => {
    const res = await api(ctx.app, lead).get('/api/items?cursor=not-a-cursor');
    expect(res.statusCode).toBe(400);
  });
});

describe('search', () => {
  it('builds prefix queries and strips operators', () => {
    expect(toPrefixTsQuery('Refund dup')).toBe('refund:* & dup:*');
    expect(toPrefixTsQuery("x' | !y & (z)")).toBe('x:* & y:* & z:*');
    expect(toPrefixTsQuery('  !!  ')).toBeNull();
  });

  it('finds items by number', async () => {
    const { rows } = await ctx.db.query('SELECT number FROM work_items ORDER BY number LIMIT 1');
    const res = await api(ctx.app, lead).get(`/api/items?q=%23${rows[0].number}`);
    expect(res.json().items).toHaveLength(1);
  });
});
