import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { idempotencyKeys, itemEvents, jobs, notifications, teamMemberships, users, watchers, workItems } from '../db/schema.js';
import { publishNotifications } from '../services/events.js';
import type { Handlers, Job } from './runner.js';

const STATUS_LABEL: Record<string, string> = {
  open: 'Open', pending_approval: 'Pending approval', in_progress: 'In progress', blocked: 'Blocked', resolved: 'Resolved', closed: 'Closed',
};

interface EventRow {
  id: number;
  type: string;
  data: Record<string, any>;
  actor_id: string;
  actor_name: string;
  item_id: string;
  number: number;
  title: string;
  team_id: string;
  assignee_id: string | null;
}

/** Who should hear about an event, and what to tell them. Exported for tests. */
export async function recipientsFor(tx: Tx, e: EventRow): Promise<{ userIds: Set<string>; kind: string; message: string }> {
  const ref = `#${e.number} ${e.title}`;
  const watching = await tx.select({ user_id: watchers.user_id }).from(watchers).where(eq(watchers.item_id, e.item_id));
  const userIds = new Set<string>(watching.map((r) => r.user_id));
  if (e.assignee_id) userIds.add(e.assignee_id);
  let kind = e.type;
  let message: string;

  switch (e.type) {
    case 'created':
      message = `${e.actor_name} created ${ref}`;
      // A new P1 is something every lead of the team must see immediately.
      if (e.data.priority === 1) for (const id of await teamLeads(tx, e.team_id)) userIds.add(id);
      break;
    case 'assigned':
      if (e.data.from) userIds.add(e.data.from);
      if (e.data.to) userIds.add(e.data.to);
      message = e.data.to
        ? `${e.actor_name} ${e.data.claimed ? 'took ownership of' : 'assigned'} ${ref}`
        : `${e.actor_name} unassigned ${ref}`;
      break;
    case 'status_changed':
      message = `${e.actor_name} moved ${ref} to ${STATUS_LABEL[e.data.to] ?? e.data.to}${e.data.reason ? `: “${e.data.reason}”` : ''}`;
      if (e.data.action === 'submit_for_approval') {
        kind = 'approval_requested';
        message = `${e.actor_name} requested approval for ${ref}`;
        for (const id of await teamLeads(tx, e.team_id)) userIds.add(id);
      }
      break;
    case 'commented':
      message = `${e.actor_name} commented on ${ref}`;
      break;
    case 'transferred':
      message = `${e.actor_name} transferred ${ref} to another team`;
      if (e.data.previousAssignee) userIds.add(e.data.previousAssignee);
      for (const id of await teamLeads(tx, e.team_id)) userIds.add(id);
      break;
    default:
      message = `${e.actor_name} updated ${ref}`;
  }
  userIds.delete(e.actor_id); // never notify people about their own actions
  return { userIds, kind, message };
}

async function teamLeads(tx: Tx, teamId: string): Promise<string[]> {
  const rows = await tx
    .select({ user_id: teamMemberships.user_id })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.team_id, teamId), eq(teamMemberships.role, 'lead')));
  return rows.map((r) => r.user_id);
}

async function notifyEvent(tx: Tx, job: Job): Promise<void> {
  const [event] = await tx
    .select({
      id: itemEvents.id,
      type: itemEvents.type,
      data: itemEvents.data,
      actor_id: itemEvents.actor_id,
      actor_name: users.name,
      item_id: workItems.id,
      number: workItems.number,
      title: workItems.title,
      team_id: workItems.team_id,
      assignee_id: workItems.assignee_id,
    })
    .from(itemEvents)
    .innerJoin(users, eq(users.id, itemEvents.actor_id))
    .innerJoin(workItems, eq(workItems.id, itemEvents.item_id))
    .where(eq(itemEvents.id, Number(job.payload.eventId)));
  if (!event) return; // item deleted since; nothing to do
  const { userIds, kind, message } = await recipientsFor(tx, event as EventRow);
  if (!userIds.size) return;

  // The (user_id, dedupe_key) unique constraint makes this safe to run any number of times.
  const inserted = await tx
    .insert(notifications)
    .values([...userIds].map((user_id) => ({ user_id, item_id: event.item_id, kind, message, dedupe_key: `event:${event.id}` })))
    .onConflictDoNothing({ target: [notifications.user_id, notifications.dedupe_key] })
    .returning({ user_id: notifications.user_id });
  await publishNotifications(tx, inserted.map((r) => r.user_id));
}

/**
 * Periodic maintenance, scheduled once per minute (deduplicated across workers):
 *  * overdue items → notify the owner, or the team leads when nobody owns it (once per due date);
 *  * expire old idempotency keys and prune finished jobs.
 * Every step is one set-based statement with a LIMIT, so the cost is a handful of round trips
 * regardless of backlog, and a large backlog cannot create a huge transaction; the next run continues.
 */
const SWEEP_BATCH = 500;
const PRUNE_BATCH = 5000;

async function sweep(tx: Tx): Promise<void> {
  // Pick (and lock) a batch of newly overdue items, mark them alerted, and fan out notifications,
  // all in one statement. The data-modifying CTE runs even though the final INSERT does not read it.
  // Moving the due date later re-arms the alert, because overdue_alerted_for no longer matches.
  const inserted = await tx.execute<{ user_id: string }>(sql`
    WITH due AS (
      SELECT ${workItems.id} AS id, ${workItems.number} AS number, ${workItems.title} AS title,
             ${workItems.team_id} AS team_id, ${workItems.assignee_id} AS assignee_id, ${workItems.due_at} AS due_at
      FROM ${workItems}
      WHERE ${workItems.due_at} < now()
        AND ${workItems.status} NOT IN ('resolved', 'closed')
        AND ${workItems.overdue_alerted_for} IS DISTINCT FROM ${workItems.due_at}
      ORDER BY ${workItems.due_at}
      LIMIT ${SWEEP_BATCH}
      FOR UPDATE SKIP LOCKED
    ),
    marked AS (
      UPDATE ${workItems} SET overdue_alerted_for = due.due_at FROM due WHERE ${workItems.id} = due.id
    ),
    recipients AS (
      SELECT due.*, due.assignee_id AS user_id FROM due WHERE due.assignee_id IS NOT NULL
      UNION ALL
      SELECT due.*, m.user_id
      FROM due JOIN ${teamMemberships} m ON m.team_id = due.team_id AND m.role = 'lead'
      WHERE due.assignee_id IS NULL
    )
    INSERT INTO ${notifications} (user_id, item_id, kind, message, dedupe_key)
    SELECT user_id, id, 'overdue', '#' || number || ' ' || title || ' is overdue',
           'overdue:' || id || ':' || extract(epoch FROM due_at)
    FROM recipients
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING user_id`);
  await publishNotifications(tx, inserted.rows.map((r) => r.user_id));

  await tx.execute(sql`
    DELETE FROM ${idempotencyKeys} WHERE (user_id, key) IN (
      SELECT user_id, key FROM ${idempotencyKeys} WHERE created_at < now() - interval '24 hours' LIMIT ${PRUNE_BATCH})`);
  await tx.execute(sql`
    DELETE FROM ${jobs} WHERE id IN (
      SELECT id FROM ${jobs} WHERE status = 'done' AND updated_at < now() - interval '7 days' LIMIT ${PRUNE_BATCH})`);
}

export const handlers: Handlers = {
  notify_event: notifyEvent,
  sweep: (tx) => sweep(tx),
};
