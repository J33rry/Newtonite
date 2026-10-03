import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import type { Executor } from '../db.js';
import { teams, users, workItems } from '../db/schema.js';
import { ITEM_TYPES, STATUSES, AppError, type Actor } from '../domain/types.js';

/**
 * All list views share one query builder:
 *   * authorization is part of the WHERE clause (never filtered in memory),
 *   * pagination is keyset-based (stable under concurrent inserts, O(page) at any depth),
 *   * every view is backed by an index declared in db/schema.ts.
 */

export const VIEWS = ['all', 'mine', 'unassigned', 'approvals', 'overdue', 'stale', 'requested'] as const;
export type View = (typeof VIEWS)[number];

const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values as [T, ...T[]])));

export const listQuerySchema = z.object({
  view: z.enum(VIEWS).default('all'),
  team: z.uuid().optional(),
  status: csv(STATUSES).optional(),
  type: csv(ITEM_TYPES).optional(),
  priority: z
    .string()
    .transform((s) => s.split(',').filter(Boolean).map(Number))
    .pipe(z.array(z.number().int().min(1).max(4)))
    .optional(),
  assignee: z.union([z.literal('me'), z.literal('none'), z.uuid()]).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['priority', 'recent']).default('priority'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

type Cursor = { p: number; u: string; id: string };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}
function decodeCursor(s: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (typeof c.u !== 'string' || typeof c.id !== 'string' || typeof c.p !== 'number') throw new Error();
    return c;
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor');
  }
}

/** Turns free text into a prefix-matching tsquery: "refund dup" -> 'refund:* & dup:*'. */
export function toPrefixTsQuery(q: string): string | null {
  const terms = q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 8);
  return terms.length ? terms.map((t) => `${t}:*`).join(' & ') : null;
}

/**
 * WHERE conditions for a list query. Authorization is part of the conditions (never filtered in
 * memory), and the same builder scopes the dashboard counts and the insights charts.
 */
export function buildFilters(actor: Actor, query: ListQuery): SQL[] {
  const w = workItems;
  const where: SQL[] = [];
  const active = notInArray(w.status, ['resolved', 'closed']);
  const teamsWithRole = (pred: (r: string) => boolean) => [...actor.roles].filter(([, r]) => pred(r)).map(([t]) => t);

  // Authorization: you see your teams' items, plus items you requested or own.
  if (!actor.isAdmin) {
    where.push(or(inArray(w.team_id, [...actor.roles.keys()]), eq(w.created_by, actor.id), eq(w.assignee_id, actor.id))!);
  }

  switch (query.view) {
    case 'mine':
      where.push(eq(w.assignee_id, actor.id), active);
      break;
    case 'unassigned':
      if (!actor.isAdmin) where.push(inArray(w.team_id, teamsWithRole((r) => r !== 'viewer')));
      where.push(isNull(w.assignee_id), active);
      break;
    case 'approvals':
      // Items waiting for a decision I am allowed to make (segregation of duties applied here too).
      if (!actor.isAdmin) where.push(inArray(w.team_id, teamsWithRole((r) => r === 'lead')));
      where.push(eq(w.status, 'pending_approval'), ne(w.created_by, actor.id), sql`${w.assignee_id} IS DISTINCT FROM ${actor.id}`);
      break;
    case 'overdue':
      where.push(lt(w.due_at, sql`now()`), active);
      break;
    case 'stale':
      where.push(
        inArray(w.status, ['in_progress', 'blocked']),
        lt(w.last_activity_at, sql`now() - make_interval(hours => ${config.staleAfterHours})`),
      );
      break;
    case 'requested':
      where.push(eq(w.created_by, actor.id));
      break;
    case 'all':
      break;
  }

  if (query.team) where.push(eq(w.team_id, query.team));
  if (query.status?.length) where.push(inArray(w.status, query.status));
  if (query.type?.length) where.push(inArray(w.type, query.type));
  if (query.priority?.length) where.push(inArray(w.priority, query.priority));
  if (query.assignee === 'me') where.push(eq(w.assignee_id, actor.id));
  else if (query.assignee === 'none') where.push(isNull(w.assignee_id));
  else if (query.assignee) where.push(eq(w.assignee_id, query.assignee));

  if (query.q) {
    const byNumber = query.q.match(/^(?:wi-?|#)?(\d{1,12})$/i);
    if (byNumber) {
      where.push(eq(w.number, Number(byNumber[1])));
    } else {
      const ts = toPrefixTsQuery(query.q);
      if (ts) where.push(sql`${w.search} @@ to_tsquery('english', ${ts})`);
    }
  }
  return where;
}

export async function listItems(db: Executor, actor: Actor, query: ListQuery) {
  const w = workItems;
  const where = buildFilters(actor, query);

  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    // Row comparison on (updated_at, id); the timestamp travels as Postgres text to keep microseconds.
    const after = sql`(${w.updated_at}, ${w.id}) < (${c.u}::timestamptz, ${c.id}::uuid)`;
    where.push(query.sort === 'priority' ? or(gt(w.priority, c.p), and(eq(w.priority, c.p), after))! : after);
  }
  const order =
    query.sort === 'priority'
      ? [asc(w.priority), desc(w.updated_at), desc(w.id)]
      : [desc(w.updated_at), desc(w.id)];

  const rows = await db
    .select({
      id: w.id,
      number: w.number,
      title: w.title,
      type: w.type,
      priority: w.priority,
      status: w.status,
      team_id: w.team_id,
      team_name: teams.name,
      assignee_id: w.assignee_id,
      assignee_name: users.name,
      due_at: w.due_at,
      updated_at: w.updated_at,
      last_activity_at: w.last_activity_at,
      requires_approval: w.requires_approval,
      approved: sql<boolean>`${w.approved_by} IS NOT NULL`,
      version: w.version,
      cursor_u: sql<string>`${w.updated_at}::text`,
    })
    .from(w)
    .innerJoin(teams, eq(teams.id, w.team_id))
    .leftJoin(users, eq(users.id, w.assignee_id))
    .where(and(...where))
    .orderBy(...order)
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(({ cursor_u: _c, ...item }) => item),
    nextCursor: hasMore && last ? encodeCursor({ p: last.priority, u: last.cursor_u, id: last.id }) : null,
  };
}

/** Counts are capped: "1000+" is as useful as an exact number and keeps the query bounded. */
export const COUNT_CAP = 1000;

export async function countItems(db: Executor, actor: Actor, query: ListQuery): Promise<number> {
  const capped = db
    .select({ one: sql`1` })
    .from(workItems)
    .where(and(...buildFilters(actor, query)))
    .limit(COUNT_CAP + 1)
    .as('capped');
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(capped);
  return row.n;
}

/** The "needs my attention" home page: each section is a list view with a count and a short preview. */
export async function dashboard(db: Executor, actor: Actor) {
  const sections: View[] = ['mine', 'approvals', 'unassigned', 'overdue', 'stale'];
  const results = await Promise.all(
    sections.map(async (view) => {
      const query = listQuerySchema.parse({ view, limit: 5, sort: 'priority' });
      const [list, count] = await Promise.all([listItems(db, actor, query), countItems(db, actor, query)]);
      return { view, count, capped: count > COUNT_CAP, items: list.items };
    }),
  );
  return { sections: results };
}
