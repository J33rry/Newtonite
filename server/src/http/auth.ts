import { randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { Executor } from '../db.js';
import { sessions, teamMemberships, users } from '../db/schema.js';
import { AppError, type Actor, type Role } from '../domain/types.js';

export const SESSION_COOKIE = 'ops_session';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
  interface FastifyInstance {
    actors: ActorCache;
  }
}

interface ActorRow {
  id: string;
  name: string;
  is_admin: boolean;
  team_id: string | null;
  role: Role | null;
}

const actorColumns = { id: users.id, name: users.name, is_admin: users.is_admin, team_id: teamMemberships.team_id, role: teamMemberships.role };

function toActor(rows: ActorRow[]): Actor | null {
  if (!rows.length) return null;
  const roles = new Map(rows.filter((r) => r.team_id && r.role).map((r) => [r.team_id!, r.role!]));
  return { id: rows[0].id, name: rows[0].name, isAdmin: rows[0].is_admin, roles };
}

export async function loadActor(db: Executor, userId: string): Promise<Actor | null> {
  const rows = await db
    .select(actorColumns)
    .from(users)
    .leftJoin(teamMemberships, eq(teamMemberships.user_id, users.id))
    .where(eq(users.id, userId));
  return toActor(rows);
}

/** Session + user + memberships in ONE query (previously two round trips per request). */
async function loadSession(db: Executor, token: string): Promise<{ actor: Actor; expiresAt: number } | null> {
  const rows = await db
    .select({ ...actorColumns, expires_at: sessions.expires_at })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.user_id))
    .leftJoin(teamMemberships, eq(teamMemberships.user_id, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expires_at, sql`now()`)));
  const actor = toActor(rows);
  return actor && { actor, expiresAt: rows[0].expires_at.getTime() };
}

/** What the cache needs from the realtime hub: whether invalidations can currently be heard. */
export interface AuthChangeSource {
  readonly listening: boolean;
  onAuthChange(fn: (userId: string) => void): void;
  /** Called when invalidations may have been missed (LISTEN connection lost / re-established). */
  onReset(fn: () => void): void;
}

/**
 * Short-lived, in-process cache of token -> Actor, so most requests need no auth query at all.
 *
 * Correctness does not depend on the TTL: DB triggers NOTIFY on every session/membership/user change
 * and the matching entries are evicted, so a role change still applies on the next request (give or
 * take NOTIFY latency, a few ms). The cache is bypassed entirely while the LISTEN connection is down,
 * because invalidations could be missed then. A generation counter stops a slow DB load that raced
 * an invalidation from writing the stale result back into the cache.
 */
export class ActorCache {
  private entries = new Map<string, { actor: Actor; validUntil: number }>();
  private generation = 0;

  constructor(
    private readonly source: AuthChangeSource,
    private readonly ttlMs = 10_000,
    private readonly maxEntries = 50_000,
  ) {
    source.onAuthChange((userId) => this.evictUser(userId));
    source.onReset(() => this.clear());
  }

  async resolve(db: Executor, token: string): Promise<Actor | null> {
    const enabled = this.source.listening && this.ttlMs > 0;
    if (enabled) {
      const hit = this.entries.get(token);
      if (hit && hit.validUntil > Date.now()) return hit.actor;
      if (hit) this.entries.delete(token);
    }
    const generation = this.generation;
    const loaded = await loadSession(db, token);
    if (!loaded) return null;
    if (enabled && generation === this.generation && this.source.listening) {
      if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!); // oldest first
      this.entries.set(token, { actor: loaded.actor, validUntil: Math.min(Date.now() + this.ttlMs, loaded.expiresAt) });
    }
    return loaded.actor;
  }

  evictToken(token: string): void {
    this.generation++;
    this.entries.delete(token);
  }

  evictUser(userId: string): void {
    this.generation++;
    for (const [token, entry] of this.entries) if (entry.actor.id === userId) this.entries.delete(token);
  }

  clear(): void {
    this.generation++;
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export async function createSession(db: Executor, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  await db.insert(sessions).values({ token, user_id: userId, expires_at: expiresAt });
  return { token, expiresAt };
}

/**
 * Resolves the session cookie to an Actor (user + per-team roles). Memberships are read from the
 * database (via the invalidated cache above) rather than baked into a token, so a role change takes
 * effect on the very next request.
 */
export function authenticate(db: Executor, cache: ActorCache) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
    const actor = await cache.resolve(db, token);
    if (!actor) throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired');
    req.actor = actor;
  };
}
