import { randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { Executor } from '../db.js';
import { sessions, teamMemberships, users } from '../db/schema.js';
import { AppError, type Actor } from '../domain/types.js';

export const SESSION_COOKIE = 'ops_session';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}

export async function loadActor(db: Executor, userId: string): Promise<Actor | null> {
  const rows = await db
    .select({ id: users.id, name: users.name, is_admin: users.is_admin, team_id: teamMemberships.team_id, role: teamMemberships.role })
    .from(users)
    .leftJoin(teamMemberships, eq(teamMemberships.user_id, users.id))
    .where(eq(users.id, userId));
  if (!rows.length) return null;
  const roles = new Map(rows.filter((r) => r.team_id && r.role).map((r) => [r.team_id!, r.role!]));
  return { id: rows[0].id, name: rows[0].name, isAdmin: rows[0].is_admin, roles };
}

export async function createSession(db: Executor, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  await db.insert(sessions).values({ token, user_id: userId, expires_at: expiresAt });
  return { token, expiresAt };
}

/**
 * Resolves the session cookie to an Actor (user + per-team roles). Memberships are loaded per
 * request rather than baked into a token, so a role change takes effect on the very next request.
 */
export function authenticate(db: Executor) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
    const [session] = await db
      .select({ user_id: sessions.user_id })
      .from(sessions)
      .where(and(eq(sessions.token, token), gt(sessions.expires_at, sql`now()`)));
    const actor = session && (await loadActor(db, session.user_id));
    if (!actor) throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired');
    req.actor = actor;
  };
}
