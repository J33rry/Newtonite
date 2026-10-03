# OpsDesk: operational work coordination

An internal web app that replaces chat threads and spreadsheets for operational work: customer
issues, incidents, payment investigations, compliance requests and approvals. Every request becomes
a **work item** with a clear owner, state, priority, enforced workflow and complete history.

- **Stack:** Next.js 16 (App Router) + TanStack Query + Recharts · Fastify 5 + TypeScript ·
  Drizzle ORM (typed queries, drizzle-kit migrations) · PostgreSQL 16 · a background worker on a
  Postgres job queue
- **Screens:** Overview (KPI tiles with sparklines, created-vs-resolved, work by status, my tasks,
  team queue) · All work / My work / Team queue / Approvals (filterable, paginated table with inline
  Claim) · Insights (throughput, backlog trend, work by team and priority, time to resolve, ageing)
  · item detail · create form. The visual design follows the mock-ups in `web/design/`.
- **Design rationale:** see [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md)

---

## Quick start

Requirements: Node 20+ (tested on 26), pnpm 9+, Docker.

```bash
pnpm install
pnpm db:up            # Postgres on localhost:5433 (also creates the ops_test database)
pnpm seed             # migrate and load demo data: 6 teams, ~400 users, 60k work items (~10s)
```

Then run these in three terminals:

```bash
pnpm dev:api          # Fastify API on http://localhost:4000
pnpm dev:worker       # background jobs: notifications, overdue sweep
pnpm dev:web          # Next.js on http://localhost:3000
```

Open http://localhost:3000 and pick a demo user. Use a second browser (or a private window) to act
as two people at once.

```bash
pnpm test             # 51 server tests against a real Postgres (ops_test)
pnpm typecheck
```

**Changing the schema:** edit `server/src/db/schema.ts`, then run `pnpm db:generate` to write a new
migration into `server/drizzle/`. The API and the worker apply pending migrations on startup.
`pnpm db:studio` opens Drizzle Studio to browse the data.

> If your database was created before the move to Drizzle, reset it once:
> `docker compose down -v && pnpm db:up && pnpm seed`.

Configuration (all optional): `DATABASE_URL`, `PORT`, `API_URL` (for Next.js), `SEED_ITEMS`,
`STALE_AFTER_HOURS`, `WORKER_POLL_MS`, `DEV_LOGIN=false` (disables the demo sign-in).

## Demo users

| User | Teams and roles | Good for |
|---|---|---|
| **Alice Chen** | Payments **lead** | approving, reassigning, changing priority |
| **Bob Okafor** | Payments member, Support viewer | claiming and working items |
| **Carol Diaz** | Support **lead**, Payments viewer | read-only access to another team |
| **Dan Kowalski** | Platform member, Support member | multi-team member |
| **Erin Patel** | Compliance **lead**, Payments member | |
| **Frank Mills** | Platform **lead**, Security member | |
| **Grace Admin** | admin | sees everything; still cannot approve her own requests |
| **Rita Requester** | no team | raises requests and follows only her own |

## Things to try (the non-CRUD behaviours)

1. **Claim race.** Open *"Duplicate charges reported on checkout"* (P1, unassigned) as Alice and as
   Bob in two browsers. Both click **Take ownership**. One wins; the other's optimistic update rolls
   back with "Already owned by …".
2. **Stale edit.** Alice clicks **Edit** on an item. Bob changes the same item. Alice's editor
   immediately shows *"This item changed while you were editing"* with their value next to hers, and
   she chooses to keep or discard. Saving with an old version is rejected by the API
   (`409 VERSION_CONFLICT`), not just by the UI.
3. **Approval workflow and segregation of duties.** *"Manual refund of $4,800"* is pending approval.
   Bob (the requester) cannot approve. Alice can. Work cannot start or be resolved before approval.
4. **Live updates.** Any change appears in other open browsers within moments (see the **Live**
   indicator), and notifications arrive in the 🔔 menu via the worker.
5. **Double submit.** Each create form, comment and action carries an idempotency key. A
   double-click or a network retry creates one item, not two.
6. **Authorization without the UI.** As Carol (Payments viewer), call
   `POST /api/items/:id/claim` directly: `403`. As someone outside the team: `404`.
7. **Charts.** Overview and Insights are computed in Postgres within the viewer's permissions and
   time zone; each chart has a table view (toggle in its corner) with the exact numbers.
8. **Scale.** The dashboard, filters, search and charts stay responsive over 60k items. Search supports
   prefixes (`refu dupl`) and item numbers (`#60001`).

---

## Architecture

```
 Browser (Next.js + TanStack Query)
   │  same-origin /api/* (rewrite proxy)        ▲ Server-Sent Events: "item X is now vN"
   ▼                                            │
 Fastify API ── authenticate (session cookie) ──┤
   │  routes → services (authorize · lock/version · workflow · write state + event + outbox job)
   │  one transaction per mutation (+ idempotency key)       LISTEN ops_events
   ▼                                                                │
 PostgreSQL ── work_items · item_events · jobs · notifications ── NOTIFY on commit
   ▲
   │  SELECT … FOR UPDATE SKIP LOCKED
 Worker(s) ── notify_event (idempotent) · sweep (overdue alerts, key expiry) · retries / dead-letter / lease reaper
```

| Path | What lives there |
|---|---|
| `server/src/db/schema.ts` | Drizzle schema — tables, constraints and the indexes behind every list view (source of truth) |
| `server/drizzle/` | Migrations generated from the schema by drizzle-kit, applied on startup |
| `server/src/domain/workflow.ts` | Workflow state machine (pure) |
| `server/src/domain/policy.ts` | Authorization rules (pure) |
| `server/src/services/items.ts` | All mutations: claim (compare-and-set), version-checked edits and transitions, history |
| `server/src/services/listing.ts` | Filters, views, search, keyset pagination, dashboard |
| `server/src/services/insights.ts` | Chart aggregates (backlog reconstruction, flow, resolution times) |
| `server/src/http/mutation.ts` | Transaction + idempotency wrapper |
| `server/src/jobs/` | Outbox enqueue, worker runner, handlers |
| `server/src/realtime.ts` | LISTEN/NOTIFY → SSE fan-out |
| `web/lib/queries.ts` | Query keys, the optimistic mutation lifecycle |
| `web/lib/realtime.ts` | SSE subscription → cache invalidation |
| `web/components/EditPanel.tsx` | Stale-edit / conflict UX |
| `web/components/charts/` | Chart components and the validated chart palette |
| `web/components/AppShell.tsx` | Sidebar, top bar, notifications, live indicator |

### Workflow

```
open ──start──► in_progress ──resolve──► resolved ──close──► closed
 │                 │   ▲                    │                   │
 │            block│   │unblock             └──────reopen───────┴──► open
 │                 ▼   │
 │               blocked
 └─submit_for_approval─► pending_approval ──approve──► open / in_progress
                                  └──reject──► closed
```

Rules: no work starts and nothing is resolved without an owner or before a required approval; a
reason is required for block, reject and reopen; releasing or unassigning active work returns it to
`open`.

### API summary

All responses are JSON. Errors have the shape `{ error: { code, message, details? } }`. Mutations
accept `Idempotency-Key`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/dashboard` | attention sections: count + top 5 each |
| GET | `/api/insights?days=7\|14\|30\|90&team=&tz=` | KPI series, created/resolved flow, by status/team, time to resolve, ageing |
| GET | `/api/items?view=&team=&status=&priority=&type=&assignee=&q=&sort=&cursor=&limit=` | keyset paginated; first page also returns a capped `total` |
| POST | `/api/items` | create |
| GET | `/api/items/:id` | includes `permissions`, allowed `actions`, `canClaim` |
| PATCH | `/api/items/:id` | `{ expectedVersion, title?, description?, type?, priority?, dueAt? }` |
| POST | `/api/items/:id/claim` · `/release` | compare-and-set ownership |
| POST | `/api/items/:id/assign` | lead; `{ expectedVersion, assigneeId }` |
| POST | `/api/items/:id/transition` | `{ expectedVersion, action, reason? }` |
| POST | `/api/items/:id/transfer` | lead; `{ expectedVersion, teamId }` |
| GET/POST | `/api/items/:id/events` · `/comments` | timeline (keyset by id) |
| PUT/DELETE | `/api/items/:id/watch` | |
| GET/POST | `/api/notifications` · `/read` | |
| GET | `/api/stream` | Server-Sent Events |

## Testing strategy

Tests target the behaviours that would be most dangerous if wrong, against a real Postgres. Mocks
would hide exactly the locking and transaction behaviour under test.

| File | Covers |
|---|---|
| `concurrency.test.ts` | 8 simultaneous claims → 1 owner; burst of 10 stale edits → 1 wins, 9 conflicts, no lost update; concurrent resolves; idempotent replay (sequential and concurrent), key reuse rejected, failed attempts not cached |
| `authorization.test.ts` | 401 without a session, 404 for other teams (incl. list/search), viewer cannot claim, lead-only priority, assignee must be a team member, approval gate and segregation of duties, requester visibility, role revocation takes effect immediately, admin listing |
| `jobs.test.ts` | outbox commits and rolls back with the change, duplicate execution → one notification, no self-notification, retry → backoff → dead, partial work rolled back, 4 concurrent workers never share a job, crashed-worker lease recovery, sweep dedupe, overdue alert once |
| `listing.test.ts` | keyset pagination returns every row exactly once under heavy sort-key ties, cursor tampering → 400, search query sanitising |
| `insights.test.ts` | backlog reconstructed correctly day by day, flow totals, overdue timing, charts never count other teams' work, input validation |
| `domain.test.ts` | workflow state machine and policy rules as pure functions |

I checked that the tests can fail: for example, removing the `assignee_id IS NULL` guard from the
claim query makes the race test fail.

## Known limitations

- **Authentication** is a development stand-in (pick a user), not SSO. Cookies are `httpOnly`,
  `SameSite=Lax` and the API only accepts JSON bodies, but there is no CSRF token or rate limiting.
- **No admin UI** for teams and memberships; they come from the seed.
- The **assign dropdown** loads all members of a team; large teams need a typeahead.
- **Realtime:** after a transfer, viewers in the *old* team are not notified, because messages are
  routed by the item's current team. List and dashboard refreshes are throttled to every 3s. Each
  API instance holds one SSE connection per open tab; very large fleets would want a dedicated
  realtime tier.
- **Notifications** are in-app only, with no per-user preferences.
- **Search** is English-stemmed, prefix-matched full text, ordered by the chosen sort rather than by
  relevance.
- **Due dates** can be set at creation and through the API; the edit panel does not expose them yet.
- The **frontend has no automated tests**; it was verified manually in the browser. Playwright
  end-to-end tests of the claim race and the conflict flow would come next.
- Dashboard counts are capped at 1000.
- **Chart history** for "assigned to me" / "unassigned" / "overdue" uses each item's *current* owner
  and due date (the open-backlog series is exact). A reopened item's earlier closed period is not
  remembered. Storing daily snapshots would remove both approximations.
- The UI is light-theme only, matching the mock-ups.

## With another week

1. Playwright end-to-end tests for the two-browser scenarios above; load test with k6 at 1–2k
   concurrent SSE clients.
2. SSO (OIDC), CSRF tokens, rate limiting, and a team and membership admin screen with its own
   audit trail.
3. SLA policies per priority/type (time to first owner, time to resolve) driven by the existing
   sweep, with escalation to leads.
4. Email/Slack notification channels behind the outbox, with per-user preferences and digesting.
5. Saved views, bulk actions for leads, and a relevance-ranked search.
6. At significantly larger scale: partition `item_events` by time, move realtime fan-out to a
   dedicated service, put read replicas behind list and search, and consider an external search
   index.
