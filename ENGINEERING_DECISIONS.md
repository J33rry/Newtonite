# Engineering decisions

Eight decisions that shaped OpsDesk, with the trade-offs behind each. The brief asked for "around
five"; decisions 6–8 are short.

---

## 1. Postgres is the coordination engine: a current-state table plus an append-only history

**Decision.** Every work item has one row in `work_items` (current state plus a `version` counter).
Every meaningful change also appends a row to `item_events`, in the same transaction. Comments are
events too, so the timeline is a single ordered stream. The application never updates or deletes
events.

**Why.** The brief's core complaint is "what changed, who owns it, why was this decided?" A history
that is written in the same transaction as the change cannot drift from the real state, and
"important actions should not silently disappear" becomes a structural property, not a convention.
Reasons for decisions (reject, block, reopen) are required by the workflow and stored on the event.

**Alternatives considered.**
- *Full event sourcing* (state derived from events). It gives perfect replay, but every read needs
  projections, rebuilds and upcasting. That is too much machinery for one day, and list views at
  tens of thousands of items still need a materialised current state. I kept the history but made
  the current-state row the source of truth for reads.
- *Separate comments table.* It would be simpler to query, but the timeline would then need a UNION
  plus merged pagination. One stream with keyset pagination by `id` is simpler and scales.

**Trade-off.** The history row and the state row could in principle disagree if someone edited the
database by hand. All writes go through `services/items.ts`, which always writes both.

---

## 2. Two concurrency strategies, chosen by what the user *meant*

| Operation | Strategy | Why |
|---|---|---|
| **Claim** ("take it if it's free") | One conditional `UPDATE … WHERE assignee_id IS NULL` (compare-and-set) | The intent stays valid even if someone edited the title meanwhile, so a version check would cause pointless conflicts. When 8 people click at once, exactly one row update succeeds; the rest get `409 ALREADY_CLAIMED` naming the winner. |
| **Field edits, assignment by a lead, workflow transitions** | `SELECT … FOR UPDATE` plus an `expectedVersion` check (optimistic concurrency) | These are decisions made from what the user *saw*. If the item changed since, the write is rejected with `409 VERSION_CONFLICT`, so it never silently overwrites someone else's change. The row lock serialises concurrent writers, so the workflow and permission checks run against the latest committed state. |
| **Comments** | No version check | Discussing an item must never make someone else's edit fail. Comments bump `last_activity_at` but not `version`. |

**Frontend counterpart.** The edit panel keeps the version it started from. If a realtime update or a
409 shows the item moved on, the user sees *their* value next to *the other person's* value and
chooses to re-apply or discard. The overwrite is still possible, but it is deliberate and recorded
in the history.

**Rejected.** Pessimistic "checkout" locks (lock the item while someone has it open). They need
timeouts and heartbeats and break when people leave tabs open, which they always do.

**Tested** (`test/concurrency.test.ts`): 8 concurrent claims give exactly 1 winner and 1 history
event; 10 concurrent edits on the same version give 1 success and 9 conflicts; two concurrent
"resolve" calls produce a single transition. I also checked that the claim test fails when the
`assignee_id IS NULL` guard is removed.

---

## 3. Idempotency keys are claimed inside the mutation's own transaction

**Decision.** Every mutation accepts an `Idempotency-Key` header. `http/mutation.ts` runs
`INSERT INTO idempotency_keys … ON CONFLICT DO NOTHING` as the **first statement of the same
transaction** that performs the change, and stores the response before commit.

**Why this shape.** It handles every retry case without extra locks:
- *Retry after success*: the key exists, so the stored response is replayed (`Idempotent-Replayed: true`).
- *Concurrent duplicate* (double click, client retry while the first request is in flight): the
  second INSERT blocks on the first transaction's uncommitted row, then sees the conflict and
  replays.
- *First attempt failed*: the key row rolled back with it, so the retry really executes. Only
  successes are remembered.
- *Same key, different payload*: rejected with `422`, instead of returning a misleading result.

The frontend creates **one key per user intent** (per form instance, per comment draft, per button
press) and reuses it for automatic retries of network or 5xx failures. A retried "create" or
"resolve" therefore cannot happen twice.

**Trade-off.** Keys are stored per user and expire after 24h (the worker sweep deletes them). For
non-create endpoints the API returns the *current* item after a replay rather than a byte-for-byte
copy of the first response. That is deliberate: the client wants fresh state.

---

## 4. Authorization: per-team roles, checked per resource, enforced in services and in SQL

**Model.** Users have a role *per team*: `viewer < member < lead`. Global `admin` acts as lead
everywhere. People who raised a request keep visibility of it even outside the owning team, which
matches how intake actually works.

**Enforcement.**
- `domain/policy.ts` is a pure function `authorize(actor, permission, item)`. It is unit-tested and
  the single place where rules live: viewers can comment but not claim, only leads change priority
  or reassign, owners or leads resolve, and so on.
- Every mutation loads the item (locked) and calls the policy *inside the transaction*, so a
  concurrent transfer to another team cannot slip past a stale check.
- List and search queries put visibility **into the WHERE clause**, so nothing is filtered in
  memory and nothing leaks through pagination or counts.
- Items you cannot see return **404, not 403**, so the API does not reveal that they exist.
- **Segregation of duties:** the requester or owner of an item cannot approve it, admins included.
  This is the "payment requiring approval" case from the brief.
- Roles come from the database, not from a token, so revoking a role takes effect on the next
  request (this is tested, with and without the cache below).

**UI.** The detail endpoint returns the computed `permissions` and the list of workflow `actions`
that are both allowed and valid in the current state. The UI renders exactly those, so it never
re-implements the rules, and the server re-checks everything anyway.

**Identity cache.** Session, user and memberships load in one query, and the result is cached in
process for 10s so most requests run no auth query at all. Staleness is handled by push, not by the
TTL: triggers on `sessions`, `team_memberships` and `users` NOTIFY `ops_auth` with the user id, every
API instance evicts that user, and the user's SSE streams are closed so they reconnect under the new
roles (or get a 401). Two edge cases are covered. First, while the LISTEN connection is down the
cache is bypassed, because invalidations could be missed. Second, a generation counter stops a DB
load that raced an invalidation from re-caching the stale result.

**Trade-off.** Between commit and NOTIFY delivery (a few ms) an instance can still serve the old roles.
Triggers rather than application code send the invalidation, so a change made from psql or a
future admin tool is covered too.

---

## 5. Synchronous core, asynchronous side effects: transactional outbox plus a SKIP LOCKED worker

**Synchronous** (in the request transaction): the state change, its history event, authorization,
workflow rules, and idempotency. The user gets a definitive answer.

**Asynchronous** (worker process): notifications and periodic maintenance (overdue alerts, expiring
idempotency keys, pruning finished jobs). These are things that can be late without being wrong.

**How.**
- **Outbox.** `recordEvent()` inserts a `jobs` row in the same transaction as the change. If the
  change rolls back, the job never exists. If it commits, the job is durable even if the worker is
  down. There is no dual-write problem (tested).
- **Claiming.** `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` lets any number of workers
  poll without blocking each other or taking the same job (tested with 4 concurrent workers).
- **Failure.** Retries use exponential backoff (2s up to 5 minutes), then `dead` with `last_error`
  kept for inspection. A handler's partial writes roll back with it (tested).
- **Running more than once.** Delivery is at-least-once. Handlers are idempotent through
  `notifications (user_id, dedupe_key)` uniqueness, so running a job twice yields one notification
  (tested). The job is marked done in the same transaction as the handler's writes.
- **Crashed worker.** A reaper re-queues jobs stuck in `running` past the lease timeout. If the
  original worker later wakes up, its "done" update matches nothing, so it rolls back its work
  instead of double-applying it (tested).
- **Delay.** Users never wait on notifications. An idle worker does not poll every second: a
  statement-level trigger on `jobs` NOTIFYs `ops_jobs`, and the worker sleeps until that hint, the
  next delayed retry's `run_at`, or a 30s safety net. A notification now lands ~10–25ms after the
  change instead of up to 1s later, and an idle fleet issues almost no queries. The hint is only a
  hint: claiming is still SKIP LOCKED, and a missed NOTIFY costs latency, not correctness. If the
  LISTEN connection drops, the worker falls back to polling.
- **Set-based work.** The overdue sweep is one statement: lock a batch with SKIP LOCKED, mark it
  alerted, fan out to owners or leads, and insert the notifications. Pruning is batched the same
  way. A notification job sends one NOTIFY per batch of recipients, not one per recipient. The sweep
  is scheduled with a per-minute dedupe key, so N workers do not run it N times.

**Realtime** uses Postgres `LISTEN/NOTIFY` fanned out over Server-Sent Events. A NOTIFY is only
delivered on commit, so browsers are never told about a change that rolled back. Messages carry
only ids and versions; the browser refetches through the normal authorized API. Delivery therefore
does not need to be reliable: on reconnect the client refetches everything it shows.

Every visible event reaches every viewer's tab, so the client's reaction decides the API load
(`web/lib/realtime.ts`):
- **Scoped.** A list filtered to another team is not refetched.
- **Coalesced and jittered.** List and dashboard refreshes are batched into one per 3–5s window,
  with a random offset, so a burst does not make thousands of tabs refetch in the same instant.
- **Lazy in hidden tabs.** Data is only marked stale and refetched on focus.
- **Insights skip realtime entirely.** They poll once a minute while on screen.

**Why not Redis, Kafka or a hosted queue?** Postgres already gives transactional enqueueing, which
is the hard part. A separate broker would bring back the dual-write problem and add an extra moving
part to operate. At thousands of users, a Postgres-backed queue is well within its comfort zone.
The handler interface would let us move to a dedicated queue later if needed.

---

## 6. Read path built for growth: keyset pagination, purpose-built indexes, capped counts

- **Keyset (cursor) pagination** on `(priority, updated_at, id)` or `(updated_at, id)`. It stays
  correct under concurrent inserts (no skipped or duplicated rows) and costs O(page) at any depth.
  The cursor stores the timestamp as Postgres text, because a JS `Date` would truncate
  microseconds and break ties (tested with heavily tied data).
- **Partial indexes** shaped like the attention views: unassigned-active, my-active,
  pending-approval, overdue and stale. Dashboard sections are just list views with `limit 5`.
- **Counts are capped at 1000** ("1000+"). An exact count over a large backlog does not help anyone
  decide what to do next.
- **Search** uses a generated, weighted `tsvector` (title over description) with a GIN index and
  prefix matching ("refu dup" finds "refund … duplicate"), plus `#123` for item numbers.
- **Measured** on the seeded 60k items: dashboard ~25–40ms, list pages ~10–30ms, search <15ms, and
  walking 100 pages deep ~30ms per page including curl.

**Charts without a warehouse.** `/api/insights` derives every series from the live tables in one
pass. Items are reduced to day indexes (created day, terminal day, due day) and grouped, and the
per-day series are summed from those few groups. That is O(rows) instead of re-scanning per day, and
it took the endpoint from 0.3–2s to 25–100ms. A `terminal_at` column records when work left the
backlog. Trade-off: history that isn't stored (past owners, past due dates) uses current values; the
README lists this. The alternative, a nightly snapshot table, is more exact but adds a job, storage,
and a day of lag. Chart colours were run through a colour-vision-deficiency palette validator, and
every chart has a table view.

**Frontend state.** Server state lives only in the TanStack Query cache. Filters live in the
**URL**, so views are shareable and the back button works. Realtime events *invalidate* cache
entries rather than patching them. List and dashboard refetches are throttled to one every 3s, so a
busy period does not trigger a refetch storm across thousands of browsers.

---

## 7. Drizzle ORM: typed queries without hiding the SQL

**Decision.** All queries go through Drizzle's SQL-like query builder, and the schema in
`src/db/schema.ts` is the single source of truth. `drizzle-kit` generates migrations from it, and the
API and worker apply them on startup, serialised by an advisory lock so they never both migrate at
once.

**Why Drizzle and not Prisma or TypeORM?** This design leans on specific Postgres behaviour: a
conditional UPDATE for claiming, `SELECT … FOR UPDATE`, `FOR UPDATE SKIP LOCKED`,
`INSERT … ON CONFLICT DO NOTHING` inside the caller's transaction, row-value keyset comparisons,
partial and GIN indexes, and a generated `tsvector`. Drizzle expresses every one of these directly
(`.for('update', { skipLocked: true })`, `.onConflictDoNothing()`, a typed `sql` template for the
rest). The query you read is the query that runs. A heavier ORM would hide or fight several of
them. In exchange, column renames and type changes are now caught at compile time across services,
routes and tests.

**Choices made along the way:**
- **snake_case property names** that match the columns, so rows, domain types and the API's JSON
  share one vocabulary and the frontend contract didn't change.
- **The generated baseline migration was diffed with `pg_dump`** against the old hand-written SQL
  migrations. The only real difference was index ordering: Drizzle's `.desc()` emits
  `DESC NULLS LAST`, which would have stopped the keyset queries (`ORDER BY … DESC`) from walking the
  index. The schema uses `.desc().nullsFirst()` and the plan is checked with `EXPLAIN`.
- **Bulk seeding** uses Drizzle's `sql` template with typed table and column references for
  set-based `INSERT … SELECT`. Drizzle's `insert().select()` requires every column, including
  identity columns.
- **Tests set up fixtures and check results with raw SQL** on purpose, so they verify database state
  independently of the Drizzle code they test.
- **LISTEN/NOTIFY** stays on a dedicated `pg` client, because it is a connection-level feature
  outside an ORM's scope.

## 8. What I intentionally did not build

- **SSO / passwords.** A development sign-in picks a seeded user. Sessions, cookies and
  authorization after sign-in are real; plugging in OIDC only replaces `/api/auth/login`.
- **Team and membership admin UI.** Teams come from the seed. The authorization model supports
  changes (they take effect on the next request), but there are no screens for them.
- **Email or Slack delivery.** Notifications are in-app. The outbox makes adding a channel a new
  handler; external sends would need their own idempotency (for example a provider idempotency key).
- **Configurable workflows, SLAs per priority, attachments, analytics.** These are valuable, but each
  is a project of its own. One well-defined workflow with enforced rules seemed better than
  configurable ones with fuzzy guarantees.
