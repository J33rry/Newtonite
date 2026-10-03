import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { RealtimeHub } from '../src/realtime.js';
import { api, createItem, createTeam, createUser, resetData, type TestUser } from './helpers.js';

/**
 * The actor cache removes the auth query from most requests. The risk is serving stale permissions,
 * so these tests check that every way access can change still takes effect on the next request.
 */
let db: pg.Pool;
let hub: RealtimeHub;
let app: FastifyInstance;
let team: string;
let member: TestUser;

/** Changes made with triggers disabled: the database stays silent, as if the NOTIFY were lost. */
async function silently(sql: string, params: unknown[]) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(sql, params);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

/** NOTIFY is asynchronous (delivered on commit to another connection), so poll briefly. */
async function eventually(check: () => Promise<boolean>, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  const handle = createDb(process.env.DATABASE_URL);
  db = handle.pool;
  hub = new RealtimeHub(process.env.DATABASE_URL!, { warn() {}, error() {} });
  await hub.start();
  app = await buildApp({ db: handle.db, hub, logger: false });
});

beforeEach(async () => {
  await resetData(db);
  app.actors.clear();
  team = await createTeam(db, 'Payments');
  member = await createUser(db, 'Member', [[team, 'member']]);
});

afterAll(async () => {
  await hub?.stop();
  await app?.close();
  await db?.end();
});

describe('actor cache', () => {
  it('serves repeat requests from memory', async () => {
    expect((await api(app, member).get('/api/me')).statusCode).toBe(200);
    expect(app.actors.size).toBe(1);
    // Revoke the session without a NOTIFY: only a cache hit can still accept it.
    await silently('DELETE FROM sessions WHERE user_id = $1', [member.id]);
    expect((await api(app, member).get('/api/me')).statusCode).toBe(200);
  });

  it('applies a role change on the next request (trigger -> NOTIFY -> eviction)', async () => {
    const item = await createItem(app, member, team);
    expect(app.actors.size).toBe(1);
    await db.query(`UPDATE team_memberships SET role = 'viewer' WHERE user_id = $1`, [member.id]);
    await eventually(async () => app.actors.size === 0);
    expect((await api(app, member).post(`/api/items/${item.id}/claim`)).statusCode).toBe(403);
  });

  it('applies removal from a team and revoked sessions', async () => {
    await api(app, member).get('/api/me');
    await db.query('DELETE FROM team_memberships WHERE user_id = $1', [member.id]);
    await eventually(async () => app.actors.size === 0);
    expect((await api(app, member).get('/api/me')).json().teams).toHaveLength(0);

    await db.query('DELETE FROM sessions WHERE user_id = $1', [member.id]);
    await eventually(async () => app.actors.size === 0);
    expect((await api(app, member).get('/api/me')).statusCode).toBe(401);
  });

  it('makes logout effective immediately on the same instance', async () => {
    await api(app, member).get('/api/me');
    await api(app, member).post('/api/auth/logout');
    expect((await api(app, member).get('/api/me')).statusCode).toBe(401);
  });

  it('is bypassed while invalidations cannot be heard (LISTEN connection down)', async () => {
    const handle = createDb(process.env.DATABASE_URL);
    const deaf = await buildApp({ db: handle.db, hub: new RealtimeHub('unused', { warn() {}, error() {} }), logger: false });
    expect((await api(deaf, member).get('/api/me')).statusCode).toBe(200);
    expect(deaf.actors.size).toBe(0);
    await silently('DELETE FROM sessions WHERE user_id = $1', [member.id]);
    expect((await api(deaf, member).get('/api/me')).statusCode).toBe(401);
    await deaf.close();
    await handle.pool.end();
  });
});
