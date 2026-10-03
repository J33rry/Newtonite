<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark/header.svg"/><img src="docs/assets/header.svg" alt="OpsDesk — operational work tracker"/></picture>

<div align="center">

<a href="#quick-start"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/QUICK%20START-0d1117?style=flat-square&logo=rocket&logoColor=ffffff"/><img src="https://img.shields.io/badge/QUICK%20START-ffffff?style=flat-square&logo=rocket&logoColor=000000" alt="QUICK START"/></picture></a>
<a href="#try-it"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/TRY%20IT-0d1117?style=flat-square&logo=googlechrome&logoColor=ffffff"/><img src="https://img.shields.io/badge/TRY%20IT-ffffff?style=flat-square&logo=googlechrome&logoColor=000000" alt="TRY IT"/></picture></a>
<a href="#architecture"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/ARCHITECTURE-0d1117?style=flat-square&logo=diagramsdotnet&logoColor=ffffff"/><img src="https://img.shields.io/badge/ARCHITECTURE-ffffff?style=flat-square&logo=diagramsdotnet&logoColor=000000" alt="ARCHITECTURE"/></picture></a>
<a href="#testing"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/TESTS-0d1117?style=flat-square&logo=checkmarx&logoColor=ffffff"/><img src="https://img.shields.io/badge/TESTS-ffffff?style=flat-square&logo=checkmarx&logoColor=000000" alt="TESTS"/></picture></a>
<a href="ENGINEERING_DECISIONS.md"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/DECISIONS-0d1117?style=flat-square&logo=readthedocs&logoColor=ffffff"/><img src="https://img.shields.io/badge/DECISIONS-ffffff?style=flat-square&logo=readthedocs&logoColor=000000" alt="DECISIONS"/></picture></a>

</div>

<br>

<a id="overview"></a>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark/s01.svg"/><img src="docs/assets/s01.svg" alt="01 overview"/></picture>

An internal web app that replaces chat threads and spreadsheets for operational work — customer
issues, incidents, payment investigations, compliance requests and approvals. Every request becomes
a **work item** with a clear owner, state, priority, an enforced workflow and a complete history.
Built for the Newtonite one-day challenge, *Operations Under Pressure*: the hard parts are the
races, retries and stale screens, not the forms.

```
status    v1 · demo-ready
screens   overview · all work · my work · team queue · approvals · insights · item · create
scale     60k items · 400 users seeded · keyset paging · counts capped at 1000
realtime  postgres listen/notify → server-sent events
tests     61 server (vitest, real postgres) · 10 browser (playwright)
design    see ENGINEERING_DECISIONS.md · mock-ups in web/design/
```

<br>

<a id="stack"></a>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark/s02.svg"/><img src="docs/assets/s02.svg" alt="02 stack"/></picture>

<div align="center">

<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/TypeScript-0d1117?style=flat-square&logo=typescript&logoColor=ffffff"/><img src="https://img.shields.io/badge/TypeScript-ffffff?style=flat-square&logo=typescript&logoColor=000000" alt="TypeScript"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Next.js%2016-0d1117?style=flat-square&logo=nextdotjs&logoColor=ffffff"/><img src="https://img.shields.io/badge/Next.js%2016-ffffff?style=flat-square&logo=nextdotjs&logoColor=000000" alt="Next.js 16"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/React%2019-0d1117?style=flat-square&logo=react&logoColor=ffffff"/><img src="https://img.shields.io/badge/React%2019-ffffff?style=flat-square&logo=react&logoColor=000000" alt="React 19"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/TanStack%20Query-0d1117?style=flat-square&logo=reactquery&logoColor=ffffff"/><img src="https://img.shields.io/badge/TanStack%20Query-ffffff?style=flat-square&logo=reactquery&logoColor=000000" alt="TanStack Query"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Recharts-0d1117?style=flat-square&logo=chartdotjs&logoColor=ffffff"/><img src="https://img.shields.io/badge/Recharts-ffffff?style=flat-square&logo=chartdotjs&logoColor=000000" alt="Recharts"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Fastify%205-0d1117?style=flat-square&logo=fastify&logoColor=ffffff"/><img src="https://img.shields.io/badge/Fastify%205-ffffff?style=flat-square&logo=fastify&logoColor=000000" alt="Fastify 5"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Drizzle%20ORM-0d1117?style=flat-square&logo=drizzle&logoColor=ffffff"/><img src="https://img.shields.io/badge/Drizzle%20ORM-ffffff?style=flat-square&logo=drizzle&logoColor=000000" alt="Drizzle ORM"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/PostgreSQL%2016-0d1117?style=flat-square&logo=postgresql&logoColor=ffffff"/><img src="https://img.shields.io/badge/PostgreSQL%2016-ffffff?style=flat-square&logo=postgresql&logoColor=000000" alt="PostgreSQL 16"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Docker-0d1117?style=flat-square&logo=docker&logoColor=ffffff"/><img src="https://img.shields.io/badge/Docker-ffffff?style=flat-square&logo=docker&logoColor=000000" alt="Docker"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Vitest-0d1117?style=flat-square&logo=vitest&logoColor=ffffff"/><img src="https://img.shields.io/badge/Vitest-ffffff?style=flat-square&logo=vitest&logoColor=000000" alt="Vitest"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Playwright-0d1117?style=flat-square&logo=playwright&logoColor=ffffff"/><img src="https://img.shields.io/badge/Playwright-ffffff?style=flat-square&logo=playwright&logoColor=000000" alt="Playwright"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/pnpm-0d1117?style=flat-square&logo=pnpm&logoColor=ffffff"/><img src="https://img.shields.io/badge/pnpm-ffffff?style=flat-square&logo=pnpm&logoColor=000000" alt="pnpm"/></picture>

</div>

| layer | what | notes |
| --- | --- | --- |
| `web/` | Next.js App Router · TanStack Query · Recharts | filters live in the URL · optimistic mutations · SSE-driven cache invalidation |
| `server/` | Fastify · zod · Drizzle ORM · drizzle-kit | one transaction per mutation · idempotency keys · migrations applied on startup |
| `server/src/jobs/` | worker on a Postgres job queue | transactional outbox · `SKIP LOCKED` · backoff · dead-letter · woken by NOTIFY |
| `e2e/` | Playwright | isolated stack: own database, API, worker and production web build |

<br>

<a id="quick-start"></a>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark/s03.svg"/><img src="docs/assets/s03.svg" alt="03 quick start"/></picture>

Requires Node 20+ (tested on 26), pnpm 9+ and Docker.

```bash
pnpm install
pnpm db:up            # Postgres on localhost:5433 (also creates the ops_test database)
pnpm seed             # migrate + demo data: 6 teams, ~400 users, 60k work items (~10s)
```

Then, in three terminals:

```bash
pnpm dev:api          # Fastify API      → http://localhost:4000
pnpm dev:worker       # background jobs  → notifications, overdue sweep
pnpm dev:web          # Next.js          → http://localhost:3000
```

Open http://localhost:3000 and pick a demo user. Use a second browser (or a private window) to be
two people at once.

```bash
pnpm test             # 61 server tests against a real Postgres (ops_test)
pnpm test:e2e         # 10 Playwright browser tests on an isolated stack
pnpm typecheck
```

First browser-test run: `pnpm --filter e2e install-browsers` (downloads Chromium).

| demo user | teams · roles | good for |
| --- | --- | --- |
| `Alice Chen` | Payments **lead** | approving, reassigning, changing priority |
| `Bob Okafor` | Payments member · Support viewer | claiming and working items |
| `Carol Diaz` | Support **lead** · Payments viewer | read-only access to another team |
| `Dan Kowalski` | Platform member · Support member | multi-team member |
| `Erin Patel` | Compliance **lead** · Payments member | |
| `Frank Mills` | Platform **lead** · Security member | |
| `Grace Admin` | admin | sees everything — still cannot approve her own requests |
| `Rita Requester` | no team | raises requests and follows only her own |

<details>
<summary><b>schema changes · configuration</b></summary>
<br>

**Changing the schema:** edit `server/src/db/schema.ts`, then `pnpm db:generate` writes a new
migration into `server/drizzle/`. The API and the worker apply pending migrations on startup.
`pnpm db:studio` opens Drizzle Studio.

> Database created before the move to Drizzle? Reset it once:
> `docker compose down -v && pnpm db:up && pnpm seed`

```
DATABASE_URL         postgres connection string
PORT                 API port (default 4000)
API_URL              where Next.js proxies /api/* (default http://localhost:4000)
SEED_ITEMS           number of seeded work items (default 60000)
STALE_AFTER_HOURS    in-progress items with no activity for this long are "stale" (default 72)
WORKER_MAX_IDLE_MS   idle safety-net poll; workers are woken by NOTIFY (default 30000)
WORKER_POLL_MS       poll interval only while that LISTEN connection is down (default 1000)
DEV_LOGIN=false      disables the demo sign-in
```

</details>

<br>

<a id="try-it"></a>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark/s04.svg"/><img src="docs/assets/s04.svg" alt="04 try it"/></picture>

<div align="center">

<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/EXACTLY%20ONE%20OWNER-0d1117?style=flat-square&logoColor=ffffff"/><img src="https://img.shields.io/badge/EXACTLY%20ONE%20OWNER-ffffff?style=flat-square&logoColor=000000" alt="EXACTLY ONE OWNER"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/NO%20LOST%20UPDATES-0d1117?style=flat-square&logoColor=ffffff"/><img src="https://img.shields.io/badge/NO%20LOST%20UPDATES-ffffff?style=flat-square&logoColor=000000" alt="NO LOST UPDATES"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/IDEMPOTENT%20RETRIES-0d1117?style=flat-square&logoColor=ffffff"/><img src="https://img.shields.io/badge/IDEMPOTENT%20RETRIES-ffffff?style=flat-square&logoColor=000000" alt="IDEMPOTENT RETRIES"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/TRANSACTIONAL%20OUTBOX-0d1117?style=flat-square&logoColor=ffffff"/><img src="https://img.shields.io/badge/TRANSACTIONAL%20OUTBOX-ffffff?style=flat-square&logoColor=000000" alt="TRANSACTIONAL OUTBOX"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/SERVER--SIDE%20AUTHZ-0d1117?style=flat-square&logoColor=ffffff"/><img src="https://img.shields.io/badge/SERVER--SIDE%20AUTHZ-ffffff?style=flat-square&logoColor=000000" alt="SERVER-SIDE AUTHZ"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/SEGREGATION%20OF%20DUTIES-0d1117?style=flat-square&logoColor=ffffff"/><img src="https://img.shields.io/badge/SEGREGATION%20OF%20DUTIES-ffffff?style=flat-square&logoColor=000000" alt="SEGREGATION OF DUTIES"/></picture>

</div>

| behaviour | how to see it | what guarantees it |
| --- | --- | --- |
| `claim race` | open *"Duplicate charges reported on checkout"* (P1, unassigned) as Alice and Bob in two browsers; both click **Take ownership** | one wins; the other's optimistic update rolls back with *"Already owned by …"* — a compare-and-set `UPDATE … WHERE assignee_id IS NULL` |
| `stale edit` | Alice clicks **Edit**, Bob changes the same item | Alice's editor shows *"This item changed while you were editing"* with their value beside hers; an old version is rejected by the API (`409 VERSION_CONFLICT`), not just the UI |
| `approvals` | *"Manual refund of $4,800"* is pending approval | Bob (the requester) cannot approve, Alice can; work cannot start or resolve before approval |
| `live updates` | keep an item open in two browsers | changes appear within moments (see the **Live** indicator); notifications land in the 🔔 menu via the worker |
| `double submit` | double-click create, comment or any action | each carries an idempotency key — one item, not two; a retried request is replayed |
| `authz without the UI` | as Carol (Payments viewer) `POST /api/items/:id/claim` | `403`; from outside the team: `404` (existence is not leaked) |
| `charts` | Overview and Insights | computed in Postgres within the viewer's permissions and time zone; every chart has a table view |
| `scale` | filters, search and charts over 60k items | stay responsive; search takes prefixes (`refu dupl`) and numbers (`#60001`) |

<br>

<a id="architecture"></a>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark/s05.svg"/><img src="docs/assets/s05.svg" alt="05 architecture"/></picture>

```
 Browser (Next.js + TanStack Query)
   │  same-origin /api/* (rewrite proxy)        ▲ Server-Sent Events: "item X is now vN"
   ▼                                            │
 Fastify API ── authenticate (cached session) ──┤
   │  routes → services (authorize · lock/version · workflow · write state + event + outbox job)
   │  one transaction per mutation (+ idempotency key)       LISTEN ops_events · ops_auth
   ▼                                                                │
 PostgreSQL ── work_items · item_events · jobs · notifications ── NOTIFY on commit
   ▲
   │  SELECT … FOR UPDATE SKIP LOCKED          (woken by NOTIFY ops_jobs)
 Worker(s) ── notify_event (idempotent) · sweep (overdue alerts, key expiry) · retries / dead-letter / lease reaper
```

| path | what lives there |
| --- | --- |
| [`server/src/db/schema.ts`](server/src/db/schema.ts) | Drizzle schema — tables, constraints and the indexes behind every list view (source of truth) |
| [`server/drizzle/`](server/drizzle/) | migrations generated by drizzle-kit, plus the NOTIFY triggers; applied on startup |
| [`server/src/domain/`](server/src/domain/) | workflow state machine and authorization policy (pure functions) |
| [`server/src/services/items.ts`](server/src/services/items.ts) | all mutations: claim (compare-and-set), version-checked edits and transitions, history |
| [`server/src/services/listing.ts`](server/src/services/listing.ts) | filters, views, search, keyset pagination, dashboard |
| [`server/src/services/insights.ts`](server/src/services/insights.ts) | chart aggregates: backlog reconstruction, flow, resolution times |
| [`server/src/http/`](server/src/http/) | transaction + idempotency wrapper, session auth with an invalidated actor cache |
| [`server/src/jobs/`](server/src/jobs/) | outbox enqueue, worker runner, NOTIFY wake-up, handlers |
| [`server/src/realtime.ts`](server/src/realtime.ts) | LISTEN/NOTIFY → SSE fan-out, auth-change eviction |
| [`web/lib/queries.ts`](web/lib/queries.ts) | query keys and the optimistic mutation lifecycle |
| [`web/lib/realtime.ts`](web/lib/realtime.ts) | SSE → scoped, coalesced, jittered cache invalidation |
| [`web/components/EditPanel.tsx`](web/components/EditPanel.tsx) | stale-edit and conflict UX |
| [`web/components/charts/`](web/components/charts/) | chart components and the validated palette |

<details>
<summary><b>workflow</b></summary>
<br>

```
open ──start──► in_progress ──resolve──► resolved ──close──► closed
 │                 │   ▲                    │                   │
 │            block│   │unblock             └──────reopen───────┴──► open
 │                 ▼   │
 │               blocked
 └─submit_for_approval─► pending_approval ──approve──► open / in_progress
                                  └──reject──► closed
```

No work starts and nothing is resolved without an owner or before a required approval; a reason is
required for block, reject and reopen; releasing or unassigning active work returns it to `open`.

</details>

<details>
<summary><b>api</b></summary>
<br>

JSON everywhere. Errors look like `{ error: { code, message, details? } }`. Mutations accept
`Idempotency-Key`.

| method | path | notes |
| --- | --- | --- |
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

</details>

<br>

<a id="testing"></a>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark/s06.svg"/><img src="docs/assets/s06.svg" alt="06 testing"/></picture>

Tests aim at what would be most dangerous if wrong, against a **real Postgres** — mocks would hide
exactly the locking and transaction behaviour under test. Each guard was checked to fail when broken
(e.g. drop the `assignee_id IS NULL` guard from the claim query and the race test fails).

<div align="center">

<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/61%20SERVER%20TESTS-0d1117?style=flat-square&logo=vitest&logoColor=ffffff"/><img src="https://img.shields.io/badge/61%20SERVER%20TESTS-ffffff?style=flat-square&logo=vitest&logoColor=000000" alt="61 SERVER TESTS"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/10%20BROWSER%20TESTS-0d1117?style=flat-square&logo=playwright&logoColor=ffffff"/><img src="https://img.shields.io/badge/10%20BROWSER%20TESTS-ffffff?style=flat-square&logo=playwright&logoColor=000000" alt="10 BROWSER TESTS"/></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/80%2F80%20AT%20REPEAT--EACH%208-0d1117?style=flat-square&logoColor=ffffff"/><img src="https://img.shields.io/badge/80%2F80%20AT%20REPEAT--EACH%208-ffffff?style=flat-square&logoColor=000000" alt="80/80 AT REPEAT-EACH 8"/></picture>

</div>

| server · vitest | covers |
| --- | --- |
| `concurrency.test.ts` | 8 simultaneous claims → 1 owner · 10 stale edits → 1 wins, 9 conflicts, no lost update · concurrent resolves · idempotent replay (sequential and concurrent) · key reuse rejected · failed attempts not cached |
| `authorization.test.ts` | 401 without a session · 404 for other teams (incl. list/search) · viewer cannot claim · lead-only priority · approval gate and segregation of duties · role revocation applies immediately |
| `auth-cache.test.ts` | cached sessions · role change, team removal, revoked session and logout all evict · cache bypassed while LISTEN is down |
| `jobs.test.ts` | outbox commits/rolls back with the change · duplicate run → one notification · backoff → dead-letter · 4 workers never share a job · crashed-worker lease recovery · set-based overdue sweep · NOTIFY wake-up |
| `listing.test.ts` | keyset pagination returns every row once under sort-key ties · cursor tampering → 400 · search sanitising |
| `insights.test.ts` | backlog reconstructed day by day · flow totals · charts never count other teams' work |
| `domain.test.ts` | workflow state machine and policy rules as pure functions |

| browser · playwright | covers |
| --- | --- |
| `claim.spec.ts` | two browsers race a claim (requests held and released together) → exactly one owner, the other told who won · a claim whose response is lost is retried with the **same idempotency key** and applied once |
| `stale-edit.spec.ts` | a live warning while editing, field-level comparison, edits re-applied on top without reverting theirs · with realtime cut off, the server's 409 path and an explicit "overwrite theirs" |
| `collaboration.spec.ts` | comments appear in the other browser without a reload · approval request → worker notifies the lead → lead approves from the notification |
| `authorization.spec.ts` | viewer gets read and comment only · outsiders get "does not exist" |
| `smoke.spec.ts` | sign in through the login screen · a requester with no team creates work for another team |

`pnpm test:e2e` brings up its own stack — database `ops_e2e` (reset + seeded), API on `:4100`, the
worker, and a production `next build` on `:3100` — so it never touches dev data or the dev
servers. `pnpm --filter e2e test:ui` opens the interactive runner; failures keep a trace, video
and screenshot in `e2e/test-results/`. The browser suite found a real bug the server tests could
not: *"Apply my edits on top"* kept the old value of untouched fields and silently reverted the
other person's change (fixed in `EditPanel.tsx`, `rebase`).

<br>

<a id="limitations"></a>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark/s07.svg"/><img src="docs/assets/s07.svg" alt="07 limitations"/></picture>

| area | limitation |
| --- | --- |
| `auth` | development sign-in (pick a user), not SSO · cookies are `httpOnly` + `SameSite=Lax` and the API only takes JSON, but there is no CSRF token or rate limiting |
| `admin` | no UI for teams and memberships — they come from the seed |
| `assign` | the dropdown loads every member of a team; large teams need a typeahead |
| `realtime` | after a transfer, viewers in the *old* team are not told (messages route by current team) · list refreshes are coalesced into 3–5s windows · one SSE connection per open tab per API instance |
| `notifications` | in-app only, no per-user preferences |
| `search` | English-stemmed prefix full-text, ordered by the chosen sort rather than relevance |
| `due dates` | settable at creation and via the API; the edit panel does not expose them yet |
| `charts` | "mine / unassigned / overdue" history uses each item's *current* owner and due date (the backlog series is exact) |
| `counts` | dashboard counts are capped at 1000 |
| `ui` | light theme only, matching the mock-ups · browser tests run in Chromium at one desktop viewport |

<br>

<a id="roadmap"></a>
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark/s08.svg"/><img src="docs/assets/s08.svg" alt="08 roadmap"/></picture>

```
next      k6 load test at 1–2k concurrent SSE clients · playwright in CI (already honours CI=1)
security  SSO (OIDC) · CSRF tokens · rate limiting · team/membership admin with its own audit trail
workflow  SLA policies per priority/type, escalation to leads via the existing sweep
notify    email/slack channels behind the outbox · per-user preferences · digests
leads     saved views · bulk actions · relevance-ranked search
scale     partition item_events by time · dedicated realtime tier · read replicas for list/search
```

<br>

<div align="center">

<a href="ENGINEERING_DECISIONS.md"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/ENGINEERING%20DECISIONS-0d1117?style=flat-square&logo=readthedocs&logoColor=ffffff"/><img src="https://img.shields.io/badge/ENGINEERING%20DECISIONS-ffffff?style=flat-square&logo=readthedocs&logoColor=000000" alt="ENGINEERING DECISIONS"/></picture></a>
<a href="Newtonite_Software_Engineering_Challenge.pdf"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/CHALLENGE%20BRIEF-0d1117?style=flat-square&logo=adobeacrobatreader&logoColor=ffffff"/><img src="https://img.shields.io/badge/CHALLENGE%20BRIEF-ffffff?style=flat-square&logo=adobeacrobatreader&logoColor=000000" alt="CHALLENGE BRIEF"/></picture></a>
<a href="#overview"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/BACK%20TO%20TOP-0d1117?style=flat-square&logo=githubactions&logoColor=ffffff"/><img src="https://img.shields.io/badge/BACK%20TO%20TOP-ffffff?style=flat-square&logo=githubactions&logoColor=000000" alt="BACK TO TOP"/></picture></a>

<br>

<sub><code>status: v1 · ready for review</code></sub>

</div>
