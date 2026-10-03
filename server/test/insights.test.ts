import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTeam, createUser, resetData, setupApp, type TestCtx, type TestUser } from './helpers.js';

/** Charts are only useful if the numbers are right — and they must respect visibility like lists do. */
let ctx: TestCtx;
let team: string, other: string;
let lead: TestUser, outsider: TestUser;

const DAY = 86_400_000;
const ago = (days: number, hours = 12) => new Date(Date.now() - days * DAY - hours * 3_600_000 + 12 * 3_600_000).toISOString();

beforeAll(async () => {
  ctx = await setupApp();
  await resetData(ctx.db);
  team = await createTeam(ctx.db, 'Payments');
  other = await createTeam(ctx.db, 'Secret');
  lead = await createUser(ctx.db, 'Lead', [[team, 'lead']]);
  outsider = await createUser(ctx.db, 'Out', [[other, 'lead']]);
  const insert = (teamId: string, createdAt: string, terminalAt: string | null, extra: Record<string, unknown> = {}) =>
    ctx.db.query(
      `INSERT INTO work_items (team_id, title, type, priority, status, created_by, created_at, terminal_at, assignee_id, due_at)
       VALUES ($1, 'x', 'task', $2, $3, $4, $5, $6, $7, $8)`,
      [teamId, extra.priority ?? 3, terminalAt ? 'resolved' : 'open', extra.creator ?? lead.id, createdAt, terminalAt, extra.assignee ?? null, extra.due ?? null],
    );
  await insert(team, ago(20), null);                       // open the whole window
  await insert(team, ago(3), ago(1));                      // created 3 days ago, resolved yesterday
  await insert(team, ago(2), null, { assignee: lead.id }); // created 2 days ago, mine
  await insert(team, ago(30), null, { due: ago(4) });      // overdue since 4 days ago
  await insert(team, ago(40), ago(35));                    // resolved before the window: excluded
  for (let i = 0; i < 5; i++) await insert(other, ago(1), null, { creator: outsider.id }); // another team's work
});

afterAll(async () => {
  await ctx?.app.close();
  await ctx?.db.end();
});

describe('insights', () => {
  it('reconstructs daily backlog and flow from created/terminal timestamps', async () => {
    const res = await api(ctx.app, lead).get('/api/insights?days=7&tz=UTC');
    expect(res.statusCode).toBe(200);
    const { kpis, flow, byStatus } = res.json();
    const open = kpis.open.points.map((p: { value: number }) => p.value);
    // 8 points: baseline (8 days ago .. 7 days ago end) then each day of the window.
    expect(open).toHaveLength(8);
    expect(open[0]).toBe(2);           // the 20-day-old and the 30-day-old item
    expect(open[open.length - 3]).toBe(4); // two days ago: + created-3-days-ago + created-2-days-ago
    expect(kpis.open.current).toBe(3); // one was resolved yesterday
    expect(kpis.mine.current).toBe(1);
    expect(kpis.overdue.current).toBe(1);
    expect(kpis.overdue.previous).toBe(0); // was not yet overdue at the baseline

    const created = flow.reduce((s: number, d: { created: number }) => s + d.created, 0);
    const resolved = flow.reduce((s: number, d: { resolved: number }) => s + d.resolved, 0);
    expect([created, resolved]).toEqual([2, 1]);
    expect(byStatus.reduce((s: number, r: { count: number }) => s + r.count, 0)).toBe(kpis.open.current);
  });

  it('never counts work from teams the viewer cannot see', async () => {
    const mine = (await api(ctx.app, lead).get('/api/insights?days=7&tz=UTC')).json();
    expect(mine.byTeam.map((t: { team: string }) => t.team)).toEqual(['Payments']);
    const theirs = (await api(ctx.app, outsider).get('/api/insights?days=7&tz=UTC')).json();
    expect(theirs.kpis.open.current).toBe(5);
    expect(theirs.byTeam.map((t: { team: string }) => t.team)).toEqual(['Secret']);
  });

  it('rejects unknown time zones and ranges', async () => {
    expect((await api(ctx.app, lead).get('/api/insights?tz=Mars/Base')).statusCode).toBe(400);
    expect((await api(ctx.app, lead).get('/api/insights?days=5')).statusCode).toBe(400);
  });
});
