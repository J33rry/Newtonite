import { and, eq, gte, inArray, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { teams, workItems } from '../db/schema.js';
import { AppError, type Actor } from '../domain/types.js';
import { buildFilters, listQuerySchema } from './listing.js';

/**
 * Aggregates for the overview and insights pages. Everything is computed in Postgres, scoped by
 * the same visibility rules as the list endpoint (buildFilters), so charts can never reveal work
 * from teams the user cannot see.
 *
 * Historical series are reconstructed from current rows: an item counts as open at the end of
 * day D if it was created before D ended and had not reached a terminal state by then
 * (`terminal_at`). This is exact for the open count; owner- and due-date-based series use the
 * CURRENT owner and due date, because their history is not denormalised. See ENGINEERING_DECISIONS.md.
 */

export const insightsQuerySchema = z.object({
  days: z.coerce.number().int().refine((d) => [7, 14, 30, 90].includes(d), 'days must be 7, 14, 30 or 90').default(7),
  team: z.uuid().optional(),
  tz: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9_+\-/]+$/)
    .default('UTC'),
});
export type InsightsQuery = z.infer<typeof insightsQuerySchema>;

export interface KpiSeries {
  /** value at the end of each day; the first point is the end of the day BEFORE the window (baseline) */
  points: { date: string; value: number }[];
  current: number;
  previous: number;
}

async function assertTimezone(db: Executor, tz: string) {
  const { rows } = await db.execute(sql`SELECT 1 FROM pg_timezone_names WHERE name = ${tz}`);
  if (!rows.length) throw new AppError(400, 'INVALID_TIMEZONE', `Unknown time zone ${tz}`);
}

const count = sql<number>`count(*)::int`;

export async function insights(db: Executor, actor: Actor, q: InsightsQuery) {
  await assertTimezone(db, q.tz);
  const w = workItems;
  // Visibility (and the optional team filter) — the same conditions the list endpoint uses.
  const visible = () => buildFilters(actor, listQuerySchema.parse({ view: 'all', team: q.team }));

  // Window = the last `days` calendar days in the viewer's time zone, ending now.
  const windowStart = sql`((date_trunc('day', now() AT TIME ZONE ${q.tz}) - make_interval(days => ${q.days} - 1)) AT TIME ZONE ${q.tz})`;
  /** Day index of a timestamp relative to the window start (0 = first day, -1 = the baseline day). */
  const dayIdx = (col: SQL | AnyColumn) => sql`((${col} AT TIME ZONE ${q.tz})::date - (${windowStart} AT TIME ZONE ${q.tz})::date)`;

  /**
   * 1+2. Created/resolved flow and the KPI backlog series, from ONE pass over the candidate rows.
   * Each visible item that was active at some point in the window is reduced to day indexes
   * (created day, terminal day, due day — clipped to the window) plus owner flags, and grouped.
   * The per-day series are then summed from those few groups in JS: O(rows) in Postgres instead
   * of O(rows × days) for a per-day re-scan.
   */
  const timelineQuery = async () => {
    const workTeams = [...actor.roles].filter(([, r]) => r !== 'viewer').map(([t]) => t);
    const rows = await db
      .select({
        c: sql<number>`greatest(${dayIdx(w.created_at)}, -1)`,
        t: sql<number | null>`CASE WHEN ${w.terminal_at} IS NULL THEN NULL ELSE ${dayIdx(w.terminal_at)} END`,
        due: sql<number | null>`CASE WHEN ${w.due_at} IS NULL OR ${w.due_at} >= now() THEN NULL ELSE greatest(${dayIdx(w.due_at)}, -1) END`,
        mine: sql<boolean>`coalesce(${w.assignee_id} = ${actor.id}, false)`,
        unassigned: actor.isAdmin
          ? sql<boolean>`${w.assignee_id} IS NULL`
          : sql<boolean>`(${w.assignee_id} IS NULL AND ${inArray(w.team_id, workTeams)})`,
        n: count,
      })
      .from(w)
      .where(and(...visible(), or(isNull(w.terminal_at), gte(w.terminal_at, sql`${windowStart} - interval '1 day'`))))
      .groupBy(sql`1, 2, 3, 4, 5`);

    // Calendar dates of the window in the viewer's time zone, from the baseline day (index -1) to today.
    const { rows: dayRows } = await db.execute<{ date: string }>(
      sql`SELECT to_char(d, 'YYYY-MM-DD') AS date
            FROM generate_series((now() AT TIME ZONE ${q.tz})::date - ${q.days}::int, (now() AT TIME ZONE ${q.tz})::date, interval '1 day') d`,
    );
    const dates = dayRows.map((r) => r.date);

    const flow = dates.slice(1).map((date, i) => ({
      date,
      created: rows.filter((g) => g.c === i).reduce((s, g) => s + g.n, 0),
      resolved: rows.filter((g) => g.t === i).reduce((s, g) => s + g.n, 0),
    }));

    const at = (i: number, pick: (g: (typeof rows)[number]) => boolean) =>
      rows.filter((g) => g.c <= i && (g.t === null || g.t > i) && pick(g)).reduce((s, g) => s + g.n, 0);
    const toSeries = (value: (i: number) => number): KpiSeries => {
      const points = dates.map((date, k) => ({ date, value: value(k - 1) }));
      return { points, current: points[points.length - 1].value, previous: points[0].value };
    };
    const series = (pick: (g: (typeof rows)[number]) => boolean) => toSeries((i) => at(i, pick));
    // Overdue at the end of day i: still open AND its due date had passed by then.
    const overdueSeries = () => toSeries((i) => at(i, (g) => g.due !== null && g.due <= i));
    const kpis = {
      open: series(() => true),
      mine: series((g) => g.mine),
      unassigned: series((g) => g.unassigned),
      overdue: overdueSeries(),
    };
    return { flow, kpis };
  };

  // 3. Active work by status (now).
  const byStatusQuery = () =>
    db.select({ status: w.status, count }).from(w).where(and(...visible(), isNull(w.terminal_at))).groupBy(w.status);

  // 4. Active work per team, split by priority.
  const byTeamQuery = async () => {
    const rows = await db
      .select({ team_id: teams.id, team: teams.name, priority: w.priority, count })
      .from(w)
      .innerJoin(teams, eq(teams.id, w.team_id))
      .where(and(...visible(), isNull(w.terminal_at)))
      .groupBy(teams.id, teams.name, w.priority);
    const byTeam = new Map<string, { teamId: string; team: string; p1: number; p2: number; p3: number; p4: number; total: number }>();
    for (const r of rows) {
      const t = byTeam.get(r.team_id) ?? { teamId: r.team_id, team: r.team, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 };
      t[`p${r.priority}` as 'p1'] += r.count;
      t.total += r.count;
      byTeam.set(r.team_id, t);
    }
    return [...byTeam.values()].sort((a, b) => b.total - a.total);
  };

  // 5. Time to resolution by priority, for items resolved/closed within the window.
  const resolutionQuery = async () => {
    const hours = (p: number) =>
      sql<number | null>`round((percentile_cont(${sql.raw(String(p))}) WITHIN GROUP (ORDER BY extract(epoch FROM ${w.terminal_at} - ${w.created_at})) / 3600)::numeric, 1)::float`;
    const rows = await db
      .select({ priority: w.priority, resolved: count, median_hours: hours(0.5), p90_hours: hours(0.9) })
      .from(w)
      .where(and(...visible(), gte(w.terminal_at, windowStart)))
      .groupBy(w.priority)
      .orderBy(w.priority);
    return [1, 2, 3, 4].map((p) => rows.find((r) => r.priority === p) ?? { priority: p, resolved: 0, median_hours: null, p90_hours: null });
  };

  // 6. Age of active work.
  const agingQuery = async () => {
    const rows = await db
      .select({
        bucket: sql<number>`width_bucket(extract(epoch FROM now() - ${w.created_at}) / 86400, ARRAY[1, 3, 7, 30, 90]::float8[])`,
        count,
      })
      .from(w)
      .where(and(...visible(), isNull(w.terminal_at)))
      .groupBy(sql`1`);
    const labels = ['< 1 day', '1–3 days', '3–7 days', '1–4 weeks', '1–3 months', '> 3 months'];
    return labels.map((label, i) => ({ bucket: label, count: rows.find((r) => r.bucket === i)?.count ?? 0 }));
  };

  const [{ flow, kpis }, byStatus, byTeam, resolution, aging] = await Promise.all([
    timelineQuery(), byStatusQuery(), byTeamQuery(), resolutionQuery(), agingQuery(),
  ]);
  return { days: q.days, tz: q.tz, flow, kpis, byStatus, byTeam, resolution, aging };
}
