import { and, asc, desc, eq, inArray, isNull, like, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { notifications, sessions, teamMemberships, teams, users, workItems } from '../db/schema.js';
import { AppError, notFound } from '../domain/types.js';
import { createSession, SESSION_COOKIE } from '../http/auth.js';
import { runMutation } from '../http/mutation.js';
import type { RealtimeHub } from '../realtime.js';
import { canSeeTeam } from '../services/items.js';

/** Routes that do not require a session. */
export function publicRoutes(app: FastifyInstance, db: Database, opts: { devLogin: boolean }) {
  app.get('/api/health', async () => {
    await db.execute(sql`SELECT 1`);
    return { ok: true };
  });

  /**
   * Development sign-in: choose a seeded user. This stands in for SSO (see README "Known
   * limitations"); everything after sign-in — sessions and authorization — is the real thing.
   */
  app.post('/api/auth/login', async (req, reply) => {
    if (!opts.devLogin) throw new AppError(404, 'NOT_FOUND', 'Not found');
    const { email } = z.object({ email: z.email() }).parse(req.body);
    const [user] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase()));
    if (!user) throw new AppError(401, 'UNKNOWN_USER', 'No user with that email');
    const session = await createSession(db, user.id);
    reply.setCookie(SESSION_COOKIE, session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: session.expiresAt,
    });
    return { ok: true };
  });

  app.get('/api/auth/dev-users', async () => {
    if (!opts.devLogin) throw new AppError(404, 'NOT_FOUND', 'Not found');
    const rows = await db
      .select({
        email: users.email,
        name: users.name,
        is_admin: users.is_admin,
        teams: sql<string>`coalesce(string_agg(${teams.name} || ' (' || ${teamMemberships.role} || ')', ', ' ORDER BY ${teams.name}), '')`,
      })
      .from(users)
      .leftJoin(teamMemberships, eq(teamMemberships.user_id, users.id))
      .leftJoin(teams, eq(teams.id, teamMemberships.team_id))
      .where(like(users.email, '%@demo.local'))
      .groupBy(users.id)
      .orderBy(asc(users.name));
    return { users: rows };
  });
}

/** Routes that require a session (registered under the authenticate hook). */
export function sessionRoutes(app: FastifyInstance, db: Database, hub: RealtimeHub) {
  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.delete(sessions).where(eq(sessions.token, token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const rows = await db
      .select({ id: teams.id, name: teams.name, slug: teams.slug, role: teamMemberships.role })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.team_id))
      .where(eq(teamMemberships.user_id, req.actor.id))
      .orderBy(asc(teams.name));
    return { id: req.actor.id, name: req.actor.name, isAdmin: req.actor.isAdmin, teams: rows };
  });

  app.get('/api/teams', async () => {
    const rows = await db.select({ id: teams.id, name: teams.name, slug: teams.slug }).from(teams).orderBy(asc(teams.name));
    return { teams: rows };
  });

  app.get('/api/teams/:id/members', async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    if (!canSeeTeam(req.actor, id)) throw notFound('Team');
    const rows = await db
      .select({ id: users.id, name: users.name, role: teamMemberships.role })
      .from(teamMemberships)
      .innerJoin(users, eq(users.id, teamMemberships.user_id))
      .where(eq(teamMemberships.team_id, id))
      .orderBy(asc(users.name));
    return { members: rows };
  });

  app.get('/api/notifications', async (req) => {
    const { before } = z.object({ before: z.coerce.number().int().positive().optional() }).parse(req.query);
    const mine = eq(notifications.user_id, req.actor.id);
    const [rows, [unread]] = await Promise.all([
      db
        .select({
          id: notifications.id,
          kind: notifications.kind,
          message: notifications.message,
          item_id: notifications.item_id,
          item_number: workItems.number,
          read_at: notifications.read_at,
          created_at: notifications.created_at,
        })
        .from(notifications)
        .leftJoin(workItems, eq(workItems.id, notifications.item_id))
        .where(and(mine, before ? lt(notifications.id, before) : undefined))
        .orderBy(desc(notifications.id))
        .limit(30),
      db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(mine, isNull(notifications.read_at))),
    ]);
    return { notifications: rows, unread: unread.n };
  });

  app.post('/api/notifications/read', async (req, reply) => {
    const { ids } = z.object({ ids: z.array(z.number().int()).max(500).optional() }).parse(req.body ?? {});
    return runMutation(db, req, reply, async (tx) => {
      const updated = await tx
        .update(notifications)
        .set({ read_at: sql`now()` })
        .where(and(eq(notifications.user_id, req.actor.id), isNull(notifications.read_at), ids ? inArray(notifications.id, ids) : undefined))
        .returning({ id: notifications.id });
      return { updated: updated.length };
    });
  });

  /** Server-Sent Events stream of change notifications relevant to the signed-in user. */
  app.get('/api/stream', async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\nevent: ready\ndata: {}\n\n`);
    const remove = hub.add(req.actor, res);
    req.raw.on('close', remove);
  });
}
