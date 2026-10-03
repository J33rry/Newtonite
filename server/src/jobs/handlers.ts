import { and, asc, eq, lt, notInArray, sql } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { idempotencyKeys, itemEvents, jobs, notifications, teamMemberships, users, watchers, workItems } from '../db/schema.js';
import { publish } from '../services/events.js';
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
  for (const r of inserted) await publish(tx, { kind: 'notification', userId: r.user_id });
}

/**
 * Periodic maintenance, scheduled once per minute (deduplicated across workers):
 *  * overdue items → notify the owner, or the team leads when nobody owns it (once per due date);
 *  * expire old idempotency keys and prune finished jobs.
 * Work is bounded per run so a large backlog cannot create a huge transaction; the next run continues.
 */
async function sweep(tx: Tx): Promise<void> {
  const overdue = await tx
    .select({ id: workItems.id, number: workItems.number, title: workItems.title, team_id: workItems.team_id, assignee_id: workItems.assignee_id, due_at: workItems.due_at })
    .from(workItems)
    .where(
      and(
        lt(workItems.due_at, sql`now()`),
        notInArray(workItems.status, ['resolved', 'closed']),
        sql`${workItems.overdue_alerted_for} IS DISTINCT FROM ${workItems.due_at}`,
      ),
    )
    .orderBy(asc(workItems.due_at))
    .limit(500)
    .for('update', { skipLocked: true });

  for (const item of overdue) {
    const recipients = item.assignee_id ? [item.assignee_id] : await teamLeads(tx, item.team_id);
    const dedupe = `overdue:${item.id}:${item.due_at!.toISOString()}`;
    for (const userId of recipients) {
      const inserted = await tx
        .insert(notifications)
        .values({ user_id: userId, item_id: item.id, kind: 'overdue', message: `#${item.number} ${item.title} is overdue`, dedupe_key: dedupe })
        .onConflictDoNothing({ target: [notifications.user_id, notifications.dedupe_key] })
        .returning({ id: notifications.id });
      if (inserted.length) await publish(tx, { kind: 'notification', userId });
    }
    // Moving the due date later re-arms the alert, because the stored value no longer matches.
    await tx.update(workItems).set({ overdue_alerted_for: sql`${workItems.due_at}` }).where(eq(workItems.id, item.id));
  }
  await tx.delete(idempotencyKeys).where(lt(idempotencyKeys.created_at, sql`now() - interval '24 hours'`));
  await tx.delete(jobs).where(and(eq(jobs.status, 'done'), lt(jobs.updated_at, sql`now() - interval '7 days'`)));
}

export const handlers: Handlers = {
  notify_event: notifyEvent,
  sweep: (tx) => sweep(tx),
};
