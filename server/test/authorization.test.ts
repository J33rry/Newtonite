import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createItem, createTeam, createUser, resetData, setupApp, type TestCtx, type TestUser } from './helpers.js';

/** Authorization is enforced by the API per resource — these call the API directly, bypassing any UI. */
let ctx: TestCtx;
let payments: string;
let support: string;
let lead: TestUser, member: TestUser, viewer: TestUser, outsider: TestUser, requester: TestUser;

beforeEach(async () => {
  ctx ??= await setupApp();
  await resetData(ctx.db);
  payments = await createTeam(ctx.db, 'Payments');
  support = await createTeam(ctx.db, 'Support');
  lead = await createUser(ctx.db, 'Lead', [[payments, 'lead']]);
  member = await createUser(ctx.db, 'Member', [[payments, 'member']]);
  viewer = await createUser(ctx.db, 'Viewer', [[payments, 'viewer']]);
  outsider = await createUser(ctx.db, 'Outsider', [[support, 'lead']]);
  requester = await createUser(ctx.db, 'Requester');
});

afterAll(async () => {
  await ctx?.app.close();
  await ctx?.db.end();
});

describe('resource-level authorization', () => {
  it('requires a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/items' });
    expect(res.statusCode).toBe(401);
  });

  it('reports items in other teams as not found (does not leak existence)', async () => {
    const item = await createItem(ctx.app, member, payments);
    expect((await api(ctx.app, outsider).get(`/api/items/${item.id}`)).statusCode).toBe(404);
    expect((await api(ctx.app, outsider).post(`/api/items/${item.id}/claim`)).statusCode).toBe(404);
    expect((await api(ctx.app, outsider).post(`/api/items/${item.id}/comments`, { body: 'hi' })).statusCode).toBe(404);
  });

  it('never returns other teams’ items from list or search', async () => {
    await createItem(ctx.app, member, payments, { title: 'Secret payroll adjustment' });
    const list = await api(ctx.app, outsider).get('/api/items?q=payroll');
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(0);
    const own = await api(ctx.app, viewer).get('/api/items?q=payroll');
    expect(own.json().items).toHaveLength(1);
  });

  it('lets viewers read and comment but not take ownership', async () => {
    const item = await createItem(ctx.app, member, payments);
    expect((await api(ctx.app, viewer).post(`/api/items/${item.id}/comments`, { body: 'fyi' })).statusCode).toBe(201);
    const claim = await api(ctx.app, viewer).post(`/api/items/${item.id}/claim`);
    expect(claim.statusCode).toBe(403);
    expect(claim.json().error.code).toBe('FORBIDDEN');
  });

  it('only lets leads change priority', async () => {
    const item = await createItem(ctx.app, member, payments);
    expect((await api(ctx.app, member).patch(`/api/items/${item.id}`, { expectedVersion: 1, priority: 1 })).statusCode).toBe(403);
    expect((await api(ctx.app, lead).patch(`/api/items/${item.id}`, { expectedVersion: 1, priority: 1 })).statusCode).toBe(200);
  });

  it('only assigns to members of the owning team', async () => {
    const item = await createItem(ctx.app, member, payments);
    const res = await api(ctx.app, lead).post(`/api/items/${item.id}/assign`, { expectedVersion: 1, assigneeId: outsider.id });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_ASSIGNEE');
  });

  it('enforces approval: no work before approval, and no self-approval', async () => {
    const item = await createItem(ctx.app, lead, payments, { requiresApproval: true });
    // Claiming is allowed but does not start work while approval is outstanding.
    const claimed = (await api(ctx.app, member).post(`/api/items/${item.id}/claim`)).json();
    expect(claimed.status).toBe('open');
    const start = await api(ctx.app, member).post(`/api/items/${item.id}/transition`, { expectedVersion: claimed.version, action: 'start' });
    expect(start.json().error.code).toBe('APPROVAL_REQUIRED');

    const submitted = (await api(ctx.app, member).post(`/api/items/${item.id}/transition`, { expectedVersion: claimed.version, action: 'submit_for_approval' })).json();
    expect(submitted.status).toBe('pending_approval');

    // The lead created this item, so they may not approve it.
    const selfApprove = await api(ctx.app, lead).post(`/api/items/${item.id}/transition`, { expectedVersion: submitted.version, action: 'approve' });
    expect(selfApprove.statusCode).toBe(403);

    const otherLead = await createUser(ctx.db, 'Lead2', [[payments, 'lead']]);
    const approved = await api(ctx.app, otherLead).post(`/api/items/${item.id}/transition`, { expectedVersion: submitted.version, action: 'approve' });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'in_progress', approved_by: otherLead.id });
  });

  it('lets a requester outside the team follow their own request', async () => {
    const item = await createItem(ctx.app, requester, payments);
    expect((await api(ctx.app, requester).get(`/api/items/${item.id}`)).statusCode).toBe(200);
    const mine = await api(ctx.app, requester).get('/api/items?view=requested');
    expect(mine.json().items.map((i: { id: string }) => i.id)).toEqual([item.id]);
    expect((await api(ctx.app, requester).post(`/api/items/${item.id}/claim`)).statusCode).toBe(403);
  });

  it('lets admins list and search across all teams', async () => {
    await createItem(ctx.app, member, payments, { title: 'Payroll export' });
    await createItem(ctx.app, outsider, support, { title: 'Payroll question' });
    const admin = await createUser(ctx.db, 'Admin', [], true);
    for (const url of ['/api/items', '/api/items?q=payroll&sort=recent', '/api/dashboard']) {
      expect((await api(ctx.app, admin).get(url)).statusCode).toBe(200);
    }
    expect((await api(ctx.app, admin).get('/api/items?q=payroll')).json().items).toHaveLength(2);
  });

  it('applies role changes on the next request (no stale permissions in tokens)', async () => {
    const item = await createItem(ctx.app, member, payments);
    await ctx.db.query(`UPDATE team_memberships SET role = 'viewer' WHERE user_id = $1`, [member.id]);
    expect((await api(ctx.app, member).post(`/api/items/${item.id}/claim`)).statusCode).toBe(403);
  });
});
