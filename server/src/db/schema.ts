import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, customType, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';

/**
 * Database schema — the single source of truth. Migrations in /drizzle are generated from this file
 * (`pnpm db:generate`) and applied at startup.
 *
 * Property names deliberately match the snake_case column names, so rows read from the database,
 * the domain types and the API's JSON all share one vocabulary (the frontend contract is unchanged).
 *
 * Design notes (see ENGINEERING_DECISIONS.md):
 *   * work_items holds CURRENT state with a `version` column for optimistic concurrency;
 *   * item_events is an append-only history (timeline/audit), never updated or deleted;
 *   * jobs is a transactional outbox + work queue (FOR UPDATE SKIP LOCKED);
 *   * idempotency_keys makes retried mutations safe.
 */

// Note: index columns use .desc().nullsFirst() — that is Postgres's own meaning of plain DESC, which the
// keyset queries' ORDER BY ... DESC relies on (drizzle's bare .desc() would emit DESC NULLS LAST).
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const ITEM_TYPES = ['incident', 'customer_issue', 'engineering', 'payment', 'compliance', 'task'] as const;
export const STATUSES = ['open', 'pending_approval', 'in_progress', 'blocked', 'resolved', 'closed'] as const;
export const ROLES = ['viewer', 'member', 'lead'] as const;
export const JOB_STATUSES = ['pending', 'running', 'done', 'dead'] as const;

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const ACTIVE = sql`status NOT IN ('resolved', 'closed')`;

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  is_admin: boolean('is_admin').notNull().default(false),
  created_at: tstz('created_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    created_at: tstz('created_at').notNull().defaultNow(),
    expires_at: tstz('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.user_id)],
);

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  created_at: tstz('created_at').notNull().defaultNow(),
});

export const teamMemberships = pgTable(
  'team_memberships',
  {
    team_id: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ROLES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.team_id, t.user_id] }),
    index('team_memberships_user_idx').on(t.user_id),
    check('team_memberships_role_check', sql`${t.role} IN (${inList(ROLES)})`),
  ],
);

export const workItems = pgTable(
  'work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: bigint('number', { mode: 'number' }).generatedAlwaysAsIdentity().unique(),
    team_id: uuid('team_id').notNull().references(() => teams.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    type: text('type', { enum: ITEM_TYPES }).notNull(),
    priority: smallint('priority').notNull(),
    status: text('status', { enum: STATUSES }).notNull(),
    assignee_id: uuid('assignee_id').references(() => users.id),
    created_by: uuid('created_by').notNull().references(() => users.id),
    requires_approval: boolean('requires_approval').notNull().default(false),
    approved_by: uuid('approved_by').references(() => users.id),
    approved_at: tstz('approved_at'),
    due_at: tstz('due_at'),
    version: integer('version').notNull().default(1),
    created_at: tstz('created_at').notNull().defaultNow(),
    updated_at: tstz('updated_at').notNull().defaultNow(),
    // bumped by comments too, so "stale" detection reflects any activity, not just field edits
    last_activity_at: tstz('last_activity_at').notNull().defaultNow(),
    resolved_at: tstz('resolved_at'),
    // when the item entered resolved/closed (cleared on reopen); lets insights rebuild daily backlog
    terminal_at: tstz('terminal_at'),
    // set by the overdue sweep to the due date it already alerted on (not user-visible)
    overdue_alerted_for: tstz('overdue_alerted_for'),
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`,
    ),
  },
  // Indexes back the list views (services/listing.ts): every list is filtered by team
  // (authorization) and sorted by recency or priority with keyset pagination.
  (t) => [
    check('work_items_title_check', sql`length(${t.title}) BETWEEN 1 AND 200`),
    check('work_items_type_check', sql`${t.type} IN (${inList(ITEM_TYPES)})`),
    check('work_items_priority_check', sql`${t.priority} BETWEEN 1 AND 4`),
    check('work_items_status_check', sql`${t.status} IN (${inList(STATUSES)})`),
    index('work_items_team_recent_idx').on(t.team_id, t.updated_at.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index('work_items_team_priority_idx').on(t.team_id, t.priority, t.updated_at.desc().nullsFirst(), t.id.desc().nullsFirst()).where(ACTIVE),
    index('work_items_assignee_idx').on(t.assignee_id, t.priority, t.updated_at.desc().nullsFirst()).where(ACTIVE),
    index('work_items_unassigned_idx').on(t.team_id, t.priority, t.updated_at.desc().nullsFirst()).where(sql`assignee_id IS NULL AND ${ACTIVE}`),
    index('work_items_pending_idx').on(t.team_id, t.updated_at.desc().nullsFirst()).where(sql`status = 'pending_approval'`),
    index('work_items_due_idx').on(t.due_at).where(sql`due_at IS NOT NULL AND ${ACTIVE}`),
    index('work_items_activity_idx').on(t.team_id, t.last_activity_at).where(sql`status IN ('in_progress', 'blocked')`),
    index('work_items_created_by_idx').on(t.created_by, t.updated_at.desc().nullsFirst()),
    index('work_items_search_idx').using('gin', t.search),
    index('work_items_created_idx').on(t.created_at),
    index('work_items_terminal_idx').on(t.terminal_at).where(sql`terminal_at IS NOT NULL`),
    index('work_items_active_idx').on(t.team_id).where(sql`terminal_at IS NULL`),
  ],
);

/** Append-only history. Comments are events too, so the timeline is a single ordered stream. */
export const itemEvents = pgTable(
  'item_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    item_id: uuid('item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
    actor_id: uuid('actor_id').notNull().references(() => users.id),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    // item version produced by this event (null for events that do not change item fields, e.g. comments)
    version: integer('version'),
    created_at: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('item_events_item_idx').on(t.item_id, t.id.desc().nullsFirst())],
);

export const watchers = pgTable(
  'watchers',
  {
    item_id: uuid('item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    created_at: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.item_id, t.user_id] }), index('watchers_user_idx').on(t.user_id)],
);

/** Retried mutations with the same key return the stored response instead of re-executing. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    request_hash: text('request_hash').notNull(),
    status_code: integer('status_code'),
    response: jsonb('response'),
    created_at: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.user_id, t.key] }), index('idempotency_keys_created_idx').on(t.created_at)],
);

/** Transactional outbox / job queue. */
export const jobs = pgTable(
  'jobs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    type: text('type', { enum: ['notify_event', 'sweep'] }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    dedupe_key: text('dedupe_key').unique(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    max_attempts: integer('max_attempts').notNull().default(5),
    run_at: tstz('run_at').notNull().defaultNow(),
    locked_at: tstz('locked_at'),
    locked_by: text('locked_by'),
    last_error: text('last_error'),
    created_at: tstz('created_at').notNull().defaultNow(),
    updated_at: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('jobs_status_check', sql`${t.status} IN (${inList(JOB_STATUSES)})`),
    index('jobs_ready_idx').on(t.run_at).where(sql`status = 'pending'`),
    index('jobs_running_idx').on(t.locked_at).where(sql`status = 'running'`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    item_id: uuid('item_id').references(() => workItems.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    // makes notification delivery idempotent: re-running a job cannot notify twice
    dedupe_key: text('dedupe_key').notNull(),
    read_at: tstz('read_at'),
    created_at: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('notifications_user_id_dedupe_key_key').on(t.user_id, t.dedupe_key),
    index('notifications_user_idx').on(t.user_id, t.id.desc().nullsFirst()),
    index('notifications_unread_idx').on(t.user_id).where(sql`read_at IS NULL`),
  ],
);
