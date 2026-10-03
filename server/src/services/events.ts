import { sql } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { itemEvents, watchers } from '../db/schema.js';
import type { WorkItem } from '../domain/types.js';
import { enqueue } from '../jobs/queue.js';

export const REALTIME_CHANNEL = 'ops_events';

export type EventType = 'created' | 'updated' | 'assigned' | 'status_changed' | 'transferred' | 'commented';

export type RealtimeMessage =
  | { kind: 'item'; itemId: string; teamId: string; createdBy: string; assigneeId: string | null; version: number; actorId: string; eventType: EventType }
  | { kind: 'notification'; userId: string };

/**
 * Records a history event and everything that must accompany it, inside the caller's transaction:
 *   1. the append-only event row (audit trail / timeline),
 *   2. an outbox job so notifications are delivered asynchronously and reliably,
 *   3. a NOTIFY for live UI updates. Postgres only delivers NOTIFY on COMMIT, so clients are never
 *      told about a change that later rolled back.
 */
export async function recordEvent(
  tx: Tx,
  item: WorkItem,
  actorId: string,
  type: EventType,
  data: Record<string, unknown>,
  opts: { versioned?: boolean } = { versioned: true },
): Promise<number> {
  const [event] = await tx
    .insert(itemEvents)
    .values({ item_id: item.id, actor_id: actorId, type, data, version: opts.versioned === false ? null : item.version })
    .returning({ id: itemEvents.id });
  await enqueue(tx, 'notify_event', { eventId: event.id }, { dedupeKey: `notify_event:${event.id}` });
  await publish(tx, {
    kind: 'item',
    itemId: item.id,
    teamId: item.team_id,
    createdBy: item.created_by,
    assigneeId: item.assignee_id,
    version: item.version,
    actorId,
    eventType: type,
  });
  return event.id;
}

export async function publish(db: Executor, message: RealtimeMessage): Promise<void> {
  await db.execute(sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${JSON.stringify(message)})`);
}

export async function watch(db: Executor, itemId: string, userId: string): Promise<void> {
  await db.insert(watchers).values({ item_id: itemId, user_id: userId }).onConflictDoNothing();
}
