import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import type pg from 'pg';
import { createDb, type Database } from '../src/db.js';
import { loadActor } from '../src/http/auth.js';
import type { Actor, Role } from '../src/domain/types.js';
import { RealtimeHub } from '../src/realtime.js';

/**
 * `db` is a raw pg pool: fixtures and assertions use plain SQL on purpose, so tests verify database
 * state independently of the Drizzle queries under test. `orm` is the Drizzle instance the app uses.
 */
export interface TestCtx {
  db: pg.Pool;
  orm: Database;
  app: FastifyInstance;
}

export async function setupApp(): Promise<TestCtx> {
  const { pool, db: orm } = createDb(process.env.DATABASE_URL);
  const hub = new RealtimeHub(process.env.DATABASE_URL!, { warn() {}, error() {} });
  const app = await buildApp({ db: orm, hub, logger: false });
  return { db: pool, orm, app };
}

export async function resetData(db: pg.Pool) {
  await db.query(`TRUNCATE notifications, jobs, idempotency_keys, watchers, item_events, work_items,
                  team_memberships, teams, sessions, users RESTART IDENTITY CASCADE`);
}

export async function createTeam(db: pg.Pool, name = `Team ${randomUUID().slice(0, 6)}`): Promise<string> {
  const { rows } = await db.query('INSERT INTO teams (slug, name) VALUES ($1, $2) RETURNING id', [name.toLowerCase().replace(/\W+/g, '-'), name]);
  return rows[0].id;
}

export interface TestUser {
  id: string;
  name: string;
  cookie: string;
}

export async function createUser(db: pg.Pool, name: string, memberships: [string, Role][] = [], isAdmin = false): Promise<TestUser> {
  const { rows } = await db.query('INSERT INTO users (email, name, is_admin) VALUES ($1, $2, $3) RETURNING id', [
    `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@test.local`, name, isAdmin,
  ]);
  for (const [teamId, role] of memberships) {
    await db.query('INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, $3)', [teamId, rows[0].id, role]);
  }
  const token = randomBytes(24).toString('base64url');
  await db.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [token, rows[0].id]);
  return { id: rows[0].id, name, cookie: `ops_session=${token}` };
}

export async function actorFor(db: Database, user: TestUser): Promise<Actor> {
  return (await loadActor(db, user.id))!;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export function api(app: FastifyInstance, user: TestUser) {
  const call = (method: Method, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
    app.inject({ method, url, payload: body as object | undefined, headers: { cookie: user.cookie, ...headers } });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body?: unknown, headers?: Record<string, string>) => call('POST', url, body ?? {}, headers),
    patch: (url: string, body: unknown, headers?: Record<string, string>) => call('PATCH', url, body, headers),
  };
}

export async function createItem(app: FastifyInstance, user: TestUser, teamId: string, extra: Record<string, unknown> = {}) {
  const res = await api(app, user).post('/api/items', {
    teamId, title: 'Payment stuck in pending', description: 'Investigate', type: 'payment', priority: 2, ...extra,
  });
  if (res.statusCode !== 201) throw new Error(`createItem failed: ${res.statusCode} ${res.body}`);
  return res.json() as { id: string; version: number; status: string };
}
