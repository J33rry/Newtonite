import { and, desc, eq, getTableColumns, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor, Tx } from '../db.js';
import { itemEvents, teamMemberships, teams, users, watchers, workItems } from '../db/schema.js';
import { authorize, canView, hasRole, permissionsFor, type ItemPermission } from '../domain/policy.js';
import { AppError, forbidden, notFound, type Actor, type ItemType, type WorkItem } from '../domain/types.js';
import { ACTIONS, canBeAssigned, statusAfterAssignment, transition, type WorkflowAction } from '../domain/workflow.js';
import { recordEvent, watch } from './events.js';

/** Every work_items column the application reads (the search vector and sweep bookkeeping are internal). */
const { search: _search, overdue_alerted_for: _alerted, ...ITEM } = getTableColumns(workItems);

type ItemPatch = Partial<Omit<typeof workItems.$inferInsert, 'id' | 'number' | 'version' | 'search'>>;

const TERMINAL = ['resolved', 'closed'] as const;

// ---------------------------------------------------------------------------------------------
// Loading & authorization helpers
// ---------------------------------------------------------------------------------------------

/**
 * Loads an item and checks the actor may act on it. With `lock`, the row is locked (SELECT … FOR
 * UPDATE) for the rest of the transaction, so concurrent mutations of the same item are serialised
 * and every check below runs against the latest committed state rather than a stale read.
 */
async function loadForAction(tx: Executor, actor: Actor, id: string, permission: ItemPermission, lock: boolean): Promise<WorkItem> {
  const query = tx.select(ITEM).from(workItems).where(eq(workItems.id, id));
  const [item] = lock ? await query.for('update') : await query;
  // Items the actor cannot see are reported as missing, so the API does not leak their existence.
  if (!item || !canView(actor, item)) throw notFound();
  const decision = authorize(actor, permission, item);
  if (!decision.allowed) throw forbidden(decision.reason);
  return item;
}

/** Optimistic concurrency: reject writes based on an outdated view of the item. */
function assertVersion(item: WorkItem, expectedVersion: number): void {
  if (item.version !== expectedVersion) {
    throw new AppError(409, 'VERSION_CONFLICT', 'This item was changed by someone else since you loaded it', {
      currentVersion: item.version,
    });
  }
}

/** Applies a field change and bumps the version: every state change is a new version. */
async function saveItem(tx: Tx, id: string, fields: ItemPatch): Promise<WorkItem> {
  const [row] = await tx
    .update(workItems)
    .set({ ...fields, version: sql`${workItems.version} + 1`, updated_at: sql`now()`, last_activity_at: sql`now()` })
    .where(eq(workItems.id, id))
    .returning(ITEM);
  return row;
}

async function assertTeamExists(db: Executor, teamId: string): Promise<void> {
  const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new AppError(422, 'INVALID_TEAM', 'Team does not exist');
}

async function assertAssignable(db: Executor, teamId: string, userId: string): Promise<void> {
  const [member] = await db
    .select({ user_id: teamMemberships.user_id })
    .from(teamMemberships)
    .where(and(eq(teamMemberships.team_id, teamId), eq(teamMemberships.user_id, userId), inArray(teamMemberships.role, ['member', 'lead'])))
    .limit(1);
  if (!member) throw new AppError(422, 'INVALID_ASSIGNEE', 'Items can only be assigned to members of the owning team');
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

// ---------------------------------------------------------------------------------------------
// Mutations — each runs inside the caller's transaction (see http/mutation.ts)
// ---------------------------------------------------------------------------------------------

export interface CreateItemInput {
  teamId: string;
  title: string;
  description: string;
  type: ItemType;
  priority: number;
  requiresApproval: boolean;
  dueAt: string | null;
}

export async function createItem(tx: Tx, actor: Actor, input: CreateItemInput): Promise<WorkItem> {
  // Anyone may raise a request to any team; that is the point of a shared intake.
  await assertTeamExists(tx, input.teamId);
  const [item] = await tx
    .insert(workItems)
    .values({
      team_id: input.teamId,
      title: input.title,
      description: input.description,
      type: input.type,
      priority: input.priority,
      status: 'open',
      created_by: actor.id,
      requires_approval: input.requiresApproval,
      due_at: input.dueAt ? new Date(input.dueAt) : null,
    })
    .returning(ITEM);
  await watch(tx, item.id, actor.id);
  await recordEvent(tx, item, actor.id, 'created', {
    title: item.title,
    priority: item.priority,
    type: item.type,
    requiresApproval: item.requires_approval,
  });
  return item;
}

export interface UpdateItemInput {
  title?: string;
  description?: string;
  type?: ItemType;
  priority?: number;
  dueAt?: string | null;
}

export async function updateItem(tx: Tx, actor: Actor, id: string, expectedVersion: number, patch: UpdateItemInput): Promise<WorkItem> {
  const item = await loadForAction(tx, actor, id, 'view', true);
  assertVersion(item, expectedVersion);

  // Work out what actually changes; history records before/after for each field.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const fields: ItemPatch = {};
  const consider = <K extends 'title' | 'description' | 'type' | 'priority'>(key: K, value: WorkItem[K] | undefined) => {
    if (value === undefined || value === item[key]) return;
    changes[key] = { from: item[key], to: value };
    (fields as Record<string, unknown>)[key] = value;
  };
  consider('title', patch.title);
  consider('description', patch.description);
  consider('type', patch.type);
  consider('priority', patch.priority);
  if (patch.dueAt !== undefined && iso(patch.dueAt) !== iso(item.due_at)) {
    changes.due_at = { from: iso(item.due_at), to: iso(patch.dueAt) };
    fields.due_at = patch.dueAt ? new Date(patch.dueAt) : null;
  }
  if (!Object.keys(fields).length) return item; // no-op edits do not bump the version or create history

  const needed: ItemPermission = 'priority' in fields ? 'change_priority' : 'edit';
  const decision = authorize(actor, needed, item);
  if (!decision.allowed) throw forbidden(decision.reason);
  if ('priority' in fields && Object.keys(fields).length > 1) {
    // Priority is a triage decision; check general edit rights for the other fields too.
    const editDecision = authorize(actor, 'edit', item);
    if (!editDecision.allowed) throw forbidden(editDecision.reason);
  }

  const updated = await saveItem(tx, id, fields);
  await recordEvent(tx, updated, actor.id, 'updated', { changes });
  return updated;
}

/**
 * Claiming is a compare-and-set: "assign to me IF nobody owns it". It is expressed as one
 * conditional UPDATE, so when two people click "Take it" at the same instant exactly one row update
 * succeeds and the other gets a clear 409 naming the winner. No version is needed: the user's
 * intent ("take it if it is free") is valid regardless of unrelated edits.
 */
export async function claimItem(tx: Tx, actor: Actor, id: string): Promise<WorkItem> {
  const before = await loadForAction(tx, actor, id, 'claim', false);
  const [claimed] = await tx
    .update(workItems)
    .set({
      assignee_id: actor.id,
      // Claiming starts the work, unless an approval is still outstanding.
      status: sql`CASE WHEN ${workItems.status} = 'open' AND (NOT ${workItems.requires_approval} OR ${workItems.approved_by} IS NOT NULL)
                       THEN 'in_progress' ELSE ${workItems.status} END`,
      version: sql`${workItems.version} + 1`,
      updated_at: sql`now()`,
      last_activity_at: sql`now()`,
    })
    .where(
      and(
        eq(workItems.id, id),
        eq(workItems.team_id, before.team_id), // the team we authorized against
        isNull(workItems.assignee_id),
        notInArray(workItems.status, [...TERMINAL]),
      ),
    )
    .returning(ITEM);

  if (!claimed) {
    const [now] = await tx
      .select({ ...ITEM, assignee_name: users.name })
      .from(workItems)
      .leftJoin(users, eq(users.id, workItems.assignee_id))
      .where(eq(workItems.id, id));
    if (now?.assignee_id === actor.id) {
      // Already ours (e.g. a retried request without an idempotency key): succeed without a new event.
      const { assignee_name: _name, ...item } = now;
      return item;
    }
    if (now?.assignee_id) {
      throw new AppError(409, 'ALREADY_CLAIMED', `Already owned by ${now.assignee_name}`, {
        assigneeId: now.assignee_id,
        assigneeName: now.assignee_name,
      });
    }
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot take ownership of a ${now?.status} item`);
  }
  await watch(tx, id, actor.id);
  await recordEvent(tx, claimed, actor.id, 'assigned', {
    from: null,
    to: actor.id,
    claimed: true,
    ...(claimed.status !== before.status ? { status: { from: before.status, to: claimed.status } } : {}),
  });
  return claimed;
}

/** Owner gives the item back to the team queue (or a lead unassigns it). */
export async function releaseItem(tx: Tx, actor: Actor, id: string): Promise<WorkItem> {
  const item = await loadForAction(tx, actor, id, 'release', true);
  if (!item.assignee_id) return item;
  const status = statusAfterAssignment(item, null, false);
  const updated = await saveItem(tx, id, { assignee_id: null, status });
  await recordEvent(tx, updated, actor.id, 'assigned', {
    from: item.assignee_id,
    to: null,
    ...(status !== item.status ? { status: { from: item.status, to: status } } : {}),
  });
  return updated;
}

/** A lead (re)assigns an item. Version-checked: the lead decided based on what they saw. */
export async function assignItem(tx: Tx, actor: Actor, id: string, expectedVersion: number, assigneeId: string | null): Promise<WorkItem> {
  const item = await loadForAction(tx, actor, id, 'assign', true);
  assertVersion(item, expectedVersion);
  if (!canBeAssigned(item)) throw new AppError(409, 'INVALID_TRANSITION', `Cannot reassign a ${item.status} item`);
  if (item.assignee_id === assigneeId) return item;
  if (assigneeId) await assertAssignable(tx, item.team_id, assigneeId);

  const status = statusAfterAssignment(item, assigneeId, false);
  const updated = await saveItem(tx, id, { assignee_id: assigneeId, status });
  if (assigneeId) await watch(tx, id, assigneeId);
  await recordEvent(tx, updated, actor.id, 'assigned', {
    from: item.assignee_id,
    to: assigneeId,
    ...(status !== item.status ? { status: { from: item.status, to: status } } : {}),
  });
  return updated;
}

export async function transitionItem(
  tx: Tx,
  actor: Actor,
  id: string,
  expectedVersion: number,
  action: WorkflowAction,
  reason?: string,
): Promise<WorkItem> {
  const item = await loadForAction(tx, actor, id, `workflow:${action}`, true);
  assertVersion(item, expectedVersion);
  const result = transition(item, action, reason);
  if (!result.ok) throw new AppError(409, result.code, result.message);

  const now = new Date();
  const fields: ItemPatch = { status: result.to };
  if (result.approve) Object.assign(fields, { approved_by: actor.id, approved_at: now });
  if (result.to === 'resolved') fields.resolved_at = now;
  const wasTerminal = (TERMINAL as readonly string[]).includes(item.status);
  const isTerminal = (TERMINAL as readonly string[]).includes(result.to);
  if (isTerminal && !wasTerminal) fields.terminal_at = now;
  if (action === 'reopen') Object.assign(fields, { resolved_at: null, terminal_at: null });

  const updated = await saveItem(tx, id, fields);
  await recordEvent(tx, updated, actor.id, 'status_changed', {
    action,
    from: item.status,
    to: result.to,
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
  });
  return updated;
}

/** Move ownership to another team. Clears the assignee, who may not belong to the new team. */
export async function transferItem(tx: Tx, actor: Actor, id: string, expectedVersion: number, teamId: string): Promise<WorkItem> {
  const item = await loadForAction(tx, actor, id, 'transfer', true);
  assertVersion(item, expectedVersion);
  if (item.team_id === teamId) return item;
  await assertTeamExists(tx, teamId);

  const status = statusAfterAssignment(item, null, false);
  const updated = await saveItem(tx, id, { team_id: teamId, assignee_id: null, status });
  await recordEvent(tx, updated, actor.id, 'transferred', { from: item.team_id, to: teamId, previousAssignee: item.assignee_id });
  return updated;
}

/**
 * Comments do not bump the item version: discussing an item should never cause someone else's
 * field edit to fail with a conflict. They do count as activity (for staleness detection).
 */
export async function addComment(tx: Tx, actor: Actor, id: string, body: string): Promise<{ id: number }> {
  const item = await loadForAction(tx, actor, id, 'comment', false);
  await tx.update(workItems).set({ last_activity_at: sql`now()` }).where(eq(workItems.id, id));
  await watch(tx, id, actor.id);
  const eventId = await recordEvent(tx, item, actor.id, 'commented', { body }, { versioned: false });
  return { id: eventId };
}

export async function setWatching(tx: Tx, actor: Actor, id: string, watching: boolean): Promise<{ watching: boolean }> {
  await loadForAction(tx, actor, id, 'view', false);
  if (watching) await watch(tx, id, actor.id);
  else await tx.delete(watchers).where(and(eq(watchers.item_id, id), eq(watchers.user_id, actor.id)));
  return { watching };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

const assignee = alias(users, 'assignee');
const creator = alias(users, 'creator');
const approver = alias(users, 'approver');

export async function getItemDetail(db: Executor, actor: Actor, id: string) {
  const [item] = await db
    .select({
      ...ITEM,
      team_name: teams.name,
      assignee_name: assignee.name,
      created_by_name: creator.name,
      approved_by_name: approver.name,
      watching: sql<boolean>`exists (select 1 from ${watchers} where ${watchers.item_id} = ${workItems.id} and ${watchers.user_id} = ${actor.id})`,
      watcher_count: sql<number>`(select count(*)::int from ${watchers} where ${watchers.item_id} = ${workItems.id})`,
    })
    .from(workItems)
    .innerJoin(teams, eq(teams.id, workItems.team_id))
    .innerJoin(creator, eq(creator.id, workItems.created_by))
    .leftJoin(assignee, eq(assignee.id, workItems.assignee_id))
    .leftJoin(approver, eq(approver.id, workItems.approved_by))
    .where(eq(workItems.id, id));
  if (!item || !canView(actor, item)) throw notFound();
  const permissions = permissionsFor(actor, item);
  // Actions this user can take right now (allowed by policy AND valid in the workflow), so the UI
  // shows exactly the server's rules instead of re-implementing them. The server re-checks anyway.
  const actions = ACTIONS.filter((a) => permissions[`workflow:${a}`] && transition(item, a, 'n/a').ok);
  const canClaim = permissions.claim && !item.assignee_id && canBeAssigned(item);
  return { ...item, permissions, actions, canClaim };
}

const fromUser = alias(users, 'from_user');
const toUser = alias(users, 'to_user');
const fromTeam = alias(teams, 'from_team');
const toTeam = alias(teams, 'to_team');
/** Resolves an id stored in the event payload; the CASE guards the uuid cast to the right event types. */
const payloadId = (type: string, key: 'from' | 'to') =>
  sql`CASE WHEN ${itemEvents.type} = ${type} THEN (${itemEvents.data}->>${key})::uuid END`;

/** Timeline, newest first, keyset-paginated by event id (history grows without bound). */
export async function getEvents(db: Executor, actor: Actor, id: string, before: number | null, limit: number) {
  await loadForAction(db, actor, id, 'view', false);
  const rows = await db
    .select({
      id: itemEvents.id,
      type: itemEvents.type,
      data: itemEvents.data,
      version: itemEvents.version,
      created_at: itemEvents.created_at,
      actor_id: itemEvents.actor_id,
      actor_name: users.name,
      from_name: sql<string | null>`coalesce(${fromUser.name}, ${fromTeam.name})`,
      to_name: sql<string | null>`coalesce(${toUser.name}, ${toTeam.name})`,
    })
    .from(itemEvents)
    .innerJoin(users, eq(users.id, itemEvents.actor_id))
    .leftJoin(fromUser, eq(fromUser.id, payloadId('assigned', 'from')))
    .leftJoin(toUser, eq(toUser.id, payloadId('assigned', 'to')))
    .leftJoin(fromTeam, eq(fromTeam.id, payloadId('transferred', 'from')))
    .leftJoin(toTeam, eq(toTeam.id, payloadId('transferred', 'to')))
    .where(and(eq(itemEvents.item_id, id), before ? lt(itemEvents.id, before) : undefined))
    .orderBy(desc(itemEvents.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit);
  return { events, nextBefore: hasMore ? events[events.length - 1].id : null };
}

export function canSeeTeam(actor: Actor, teamId: string): boolean {
  return hasRole(actor, teamId, 'viewer');
}
