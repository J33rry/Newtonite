import { lt, ne, sql } from 'drizzle-orm';
import { createDb, type DbHandle } from './db.js';
import { itemEvents, teamMemberships, teams, users, watchers, workItems } from './db/schema.js';
import { migrate } from './migrate.js';
import type { ItemType, Role, Status } from './domain/types.js';

/**
 * Development seed. Wipes the database and creates:
 *   * 6 teams, 8 named demo users (sign in as them) and ~400 background users;
 *   * SEED_ITEMS work items (default 60,000, ~40% still active) with history events,
 *     so list/search/dashboard performance can be judged at a realistic size;
 *   * a handful of hand-written items that set up the interesting demo scenarios.
 */

const TEAMS = [
  ['payments', 'Payments'],
  ['support', 'Customer Support'],
  ['platform', 'Platform Engineering'],
  ['compliance', 'Compliance'],
  ['operations', 'Operations'],
  ['security', 'Security'],
] as const;

const DEMO_USERS: { email: string; name: string; admin?: boolean; teams: [string, Role][] }[] = [
  { email: 'alice@demo.local', name: 'Alice Chen', teams: [['payments', 'lead']] },
  { email: 'bob@demo.local', name: 'Bob Okafor', teams: [['payments', 'member'], ['support', 'viewer']] },
  { email: 'carol@demo.local', name: 'Carol Diaz', teams: [['support', 'lead'], ['payments', 'viewer']] },
  { email: 'dan@demo.local', name: 'Dan Kowalski', teams: [['platform', 'member'], ['support', 'member']] },
  { email: 'erin@demo.local', name: 'Erin Patel', teams: [['compliance', 'lead'], ['payments', 'member']] },
  { email: 'frank@demo.local', name: 'Frank Mills', teams: [['platform', 'lead'], ['security', 'member']] },
  { email: 'grace@demo.local', name: 'Grace Admin', admin: true, teams: [] },
  { email: 'rita@demo.local', name: 'Rita Requester', teams: [] },
];

const TITLES: Record<ItemType, string[]> = {
  incident: ['Checkout error rate above 5%', 'Database replica lag on {svc}', 'Elevated 502s from {svc}', 'Queue backlog growing in {svc}', 'Partial outage: {svc} timing out'],
  customer_issue: ['Customer cannot log in (account {n})', 'Refund not received for order {n}', 'Invoice {n} shows wrong amount', 'Customer reports duplicate charge on order {n}', 'Export to CSV fails for account {n}'],
  engineering: ['Flaky test in {svc} pipeline', 'Upgrade {svc} to supported runtime', 'Slow query on {svc} orders endpoint', 'Memory leak suspected in {svc}', 'Add retry to {svc} webhook client'],
  payment: ['Payment {n} stuck in pending', 'Chargeback dispute for transaction {n}', 'Manual refund approval for order {n}', 'Settlement mismatch for batch {n}', 'Payout {n} failed to bank'],
  compliance: ['KYC review for account {n}', 'Data deletion request (GDPR) for user {n}', 'Sanctions screening hit on account {n}', 'Quarterly access review for {svc}', 'Audit evidence request: {svc} change log'],
  task: ['Rotate credentials for {svc}', 'Onboard new vendor {n}', 'Update runbook for {svc}', 'Prepare monthly ops report', 'Decommission legacy {svc} host'],
};
const SERVICES = ['billing-api', 'ledger', 'auth-service', 'search', 'notifications', 'checkout', 'reporting', 'gateway'];
const TEAM_TYPES: Record<string, ItemType[]> = {
  payments: ['payment', 'customer_issue', 'task'],
  support: ['customer_issue', 'task'],
  platform: ['incident', 'engineering', 'task'],
  compliance: ['compliance', 'task'],
  operations: ['task', 'incident', 'customer_issue'],
  security: ['incident', 'compliance', 'engineering'],
};

// Deterministic PRNG so every seed run produces the same data.
let state = 42;
const rand = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

/** Realistic mix: P1 8%, P2 22%, P3 45%, P4 25%. */
function pickPriority(): number {
  const r = rand();
  return r < 0.08 ? 1 : r < 0.3 ? 2 : r < 0.75 ? 3 : 4;
}

function weightedStatus(): Status {
  const r = rand();
  if (r < 0.35) return 'closed';
  if (r < 0.6) return 'resolved';
  if (r < 0.75) return 'open';
  if (r < 0.92) return 'in_progress';
  if (r < 0.96) return 'blocked';
  return 'pending_approval';
}

export async function seed({ db }: DbHandle, itemCount: number) {
  await db.execute(sql`TRUNCATE notifications, jobs, idempotency_keys, watchers, item_events, work_items,
                       team_memberships, teams, sessions, users RESTART IDENTITY CASCADE`);

  const teamRows = await db.insert(teams).values(TEAMS.map(([slug, name]) => ({ slug, name }))).returning({ id: teams.id, slug: teams.slug });
  const teamIds = new Map(teamRows.map((t) => [t.slug, t.id]));

  const workers = new Map<string, string[]>(); // team -> users who can own work (member/lead)
  const leads = new Map<string, string[]>();
  const memberships: (typeof teamMemberships.$inferInsert)[] = [];
  const addMembership = (userId: string, slug: string, role: Role) => {
    memberships.push({ team_id: teamIds.get(slug)!, user_id: userId, role });
    if (role !== 'viewer') workers.set(slug, [...(workers.get(slug) ?? []), userId]);
    if (role === 'lead') leads.set(slug, [...(leads.get(slug) ?? []), userId]);
  };

  const demo = await db
    .insert(users)
    .values(DEMO_USERS.map((u) => ({ email: u.email, name: u.name, is_admin: !!u.admin })))
    .returning({ id: users.id, email: users.email });
  const userIds = new Map(demo.map((u) => [u.email, u.id]));
  for (const u of DEMO_USERS) for (const [slug, role] of u.teams) addMembership(userIds.get(u.email)!, slug, role);

  const firstNames = ['Sam', 'Priya', 'Jon', 'Mei', 'Omar', 'Lena', 'Ravi', 'Ana', 'Tom', 'Zoe', 'Kenji', 'Ines', 'Luca', 'Nora', 'Yusuf'];
  const lastNames = ['Smith', 'Rao', 'Garcia', 'Kim', 'Haddad', 'Novak', 'Ito', 'Silva', 'Brown', 'Weber', 'Ali', 'Moreau'];
  const backgroundRows = await db
    .insert(users)
    .values(Array.from({ length: 400 }, (_, i) => ({ email: `user${i}@corp.local`, name: `${pick(firstNames)} ${pick(lastNames)}` })))
    .returning({ id: users.id });
  const background = backgroundRows.map((r) => r.id);
  for (const id of background) {
    const slugs = new Set([pick(TEAMS)[0], ...(rand() < 0.3 ? [pick(TEAMS)[0]] : [])]);
    for (const slug of slugs) addMembership(id, slug, rand() < 0.08 ? 'lead' : rand() < 0.15 ? 'viewer' : 'member');
  }
  await db.insert(teamMemberships).values(memberships);
  const everyone = [...userIds.values(), ...background];

  // ---- bulk items -------------------------------------------------------------------------
  const now = Date.now();
  const DAY = 86_400_000;
  const BATCH = 2000; // 2000 rows × 16 columns stays under Postgres's 65,535 bind-parameter limit
  for (let start = 0; start < itemCount; start += BATCH) {
    const items: (typeof workItems.$inferInsert)[] = [];
    for (let i = start; i < Math.min(itemCount, start + BATCH); i++) {
      const slug = pick(TEAMS)[0];
      const type = pick(TEAM_TYPES[slug]);
      const title = pick(TITLES[type]).replace('{svc}', pick(SERVICES)).replace('{n}', String(10000 + Math.floor(rand() * 89999)));
      const status = weightedStatus();
      const createdAt = now - Math.floor(rand() * 365 * DAY);
      const ageing = status === 'resolved' || status === 'closed' ? rand() * 20 * DAY : rand() * 10 * DAY;
      // Never in the future: recent items get a fraction of their real age, so history stays smooth.
      const updatedAt = new Date(createdAt + Math.min(ageing, (now - createdAt) * rand()));
      const terminal = status === 'resolved' || status === 'closed';
      const needsOwner = status === 'in_progress' || status === 'blocked' || terminal;
      const requiresApproval = type === 'payment' || type === 'compliance' ? rand() < 0.5 || status === 'pending_approval' : status === 'pending_approval';
      const approved = requiresApproval && status !== 'open' && status !== 'pending_approval';
      items.push({
        team_id: teamIds.get(slug)!,
        title,
        description: `Raised via intake. Context for ${title.toLowerCase()}.`,
        type,
        priority: pickPriority(),
        status,
        assignee_id: needsOwner || rand() < 0.4 ? pick(workers.get(slug)!) : null,
        created_by: pick(everyone),
        requires_approval: requiresApproval,
        approved_by: approved ? pick(leads.get(slug) ?? workers.get(slug)!) : null,
        approved_at: approved ? new Date(createdAt + DAY) : null,
        due_at: rand() < 0.3 ? new Date(createdAt + (1 + rand() * 14) * DAY) : null,
        created_at: new Date(createdAt),
        updated_at: updatedAt,
        last_activity_at: updatedAt,
        resolved_at: terminal ? updatedAt : null,
        terminal_at: terminal ? updatedAt : null,
      });
    }
    await db.insert(workItems).values(items);
  }

  // History for the bulk items: a "created" event, plus an assignment and status event where relevant.
  // Set-based INSERT … SELECT keeps this to a few statements regardless of item count. (Drizzle's
  // insert().select() requires every column incl. identity ones, so these use its typed sql template.)
  const w = workItems;
  const e = itemEvents;
  const eventCols = sql`(${sql.identifier(e.item_id.name)}, ${sql.identifier(e.actor_id.name)}, ${sql.identifier(e.type.name)}, ${sql.identifier(e.data.name)}, ${sql.identifier(e.version.name)}, ${sql.identifier(e.created_at.name)})`;
  await db.execute(sql`
    INSERT INTO ${e} ${eventCols}
    SELECT ${w.id}, ${w.created_by}, 'created', jsonb_build_object('title', ${w.title}, 'priority', ${w.priority}, 'type', ${w.type}), 1, ${w.created_at}
      FROM ${w}`);
  await db.execute(sql`
    INSERT INTO ${e} ${eventCols}
    SELECT ${w.id}, ${w.assignee_id}, 'assigned', jsonb_build_object('from', null, 'to', ${w.assignee_id}, 'claimed', true), 2, ${w.created_at} + interval '1 hour'
      FROM ${w} WHERE ${w.assignee_id} IS NOT NULL`);
  await db.execute(sql`
    INSERT INTO ${e} ${eventCols}
    SELECT ${w.id}, coalesce(${w.assignee_id}, ${w.created_by}), 'status_changed', jsonb_build_object('action', 'update', 'from', 'open', 'to', ${w.status}), 3, ${w.updated_at}
      FROM ${w} WHERE ${w.status} <> 'open'`);
  await db.update(w).set({ version: 3 }).where(ne(w.status, 'open'));
  // Overdue alerts are marked as already sent so the first sweep does not flood the demo users.
  await db.update(w).set({ overdue_alerted_for: sql`${w.due_at}` }).where(lt(w.due_at, sql`now()`));
  await db.execute(sql`INSERT INTO ${watchers} (item_id, user_id) SELECT ${w.id}, ${w.created_by} FROM ${w} ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO ${watchers} (item_id, user_id) SELECT ${w.id}, ${w.assignee_id} FROM ${w} WHERE ${w.assignee_id} IS NOT NULL ON CONFLICT DO NOTHING`);

  // ---- curated demo scenarios -------------------------------------------------------------
  const u = (e: string) => userIds.get(`${e}@demo.local`)!;
  const curated: { team: string; title: string; description: string; type: ItemType; priority: number; status: Status;
    assignee?: string; creator: string; approval?: boolean; dueInHours?: number; staleDays?: number }[] = [
    { team: 'payments', title: 'Duplicate charges reported on checkout (multiple customers)', description: 'Support has 14 tickets in the last hour reporting double charges. Needs an owner now.', type: 'incident', priority: 1, status: 'open', creator: u('carol') },
    { team: 'payments', title: 'Manual refund of $4,800 for enterprise customer ACME', description: 'Refund outside policy limits; requires lead approval before processing.', type: 'payment', priority: 2, status: 'pending_approval', creator: u('bob'), assignee: u('bob'), approval: true },
    { team: 'payments', title: 'Payout 88123 failed to bank — customer escalated', description: 'Bank returned R03. Need to confirm account details and re-issue.', type: 'payment', priority: 2, status: 'in_progress', creator: u('carol'), assignee: u('bob'), dueInHours: -20 },
    { team: 'platform', title: 'Ledger replica lag above 30s during batch window', description: 'Reporting queries read stale data. Investigating vacuum and replication slots.', type: 'incident', priority: 2, status: 'in_progress', creator: u('frank'), assignee: u('dan'), staleDays: 5 },
    { team: 'compliance', title: 'GDPR deletion request for user 55120', description: 'Statutory deadline applies. Requires compliance lead sign-off.', type: 'compliance', priority: 2, status: 'open', creator: u('rita'), approval: true, dueInHours: 72 },
    { team: 'support', title: 'Customer cannot reset password (account 71002)', description: 'Reset emails not arriving. Possibly related to the notifications incident.', type: 'customer_issue', priority: 3, status: 'open', creator: u('rita') },
  ];
  await db.transaction(async (tx) => {
    for (const c of curated) {
      const activity = new Date(now - (c.staleDays ?? 0) * DAY);
      const [item] = await tx
        .insert(workItems)
        .values({
          team_id: teamIds.get(c.team)!, title: c.title, description: c.description, type: c.type, priority: c.priority, status: c.status,
          assignee_id: c.assignee ?? null, created_by: c.creator, requires_approval: !!c.approval,
          due_at: c.dueInHours !== undefined ? new Date(now + c.dueInHours * 3_600_000) : null,
          created_at: activity, updated_at: activity, last_activity_at: activity,
        })
        .returning({ id: workItems.id });
      await tx.insert(itemEvents).values({
        item_id: item.id, actor_id: c.creator, type: 'created', data: { title: c.title, priority: c.priority, type: c.type }, version: 1, created_at: activity,
      });
      await tx
        .insert(watchers)
        .values([c.creator, ...(c.assignee ? [c.assignee] : [])].map((user_id) => ({ item_id: item.id, user_id })))
        .onConflictDoNothing();
    }
  });
  await db.execute(sql`ANALYZE`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const handle = createDb();
  const count = Number(process.env.SEED_ITEMS ?? 60_000);
  const started = Date.now();
  await migrate(handle);
  await seed(handle, count);
  console.log(`Seeded ${count} items in ${((Date.now() - started) / 1000).toFixed(1)}s. Sign in as alice@demo.local, bob@demo.local, …`);
  await handle.pool.end();
}
