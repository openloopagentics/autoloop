# Autoloop — Ideas backlog (evolution backlog) design spec

**Date:** 2026-06-09
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** 1 of 6 in the self-evolution batch (ideas backlog, vision growth,
independent verification, resumable loops, preview + trends, product map). Makes the
loop's between-rounds "generate 5 improvement ideas" step durable and user-steerable:
ideas become a first-class, trackable entity the loop proposes, the user accepts/rejects/
reorders from the dashboard, and the next loop draws from.

## Goal

Today the `/autoloop` driver invents 5 improvement ideas between loops inside one
session: no record survives of what was considered, rejected, or already tried, and the
user cannot steer which idea runs next without sending a free-text message at exactly
the right moment. This spec turns ideas into durable state: the loop **proposes**, the
user **vetoes or prioritizes** asynchronously from the dashboard, and the next loop
**picks** deterministically — accepted ideas first, then proposed ones by order, never
rejected ones.

**Steering model (user decision): autonomous with veto.** The loop may build a
still-`proposed` idea without waiting for approval; the user steers by rejecting and
reordering, not by gatekeeping.

## Architecture

One new **project-level** entity, following the bug-entity pattern exactly (idempotent
PUT, run data, no `visionOwner` stamp, no transaction, no derived state) — but
project-direct **only**, never loop-scoped: ideas outlive the loop that proposed them
and feed future loops, so they live beside `messages`, not under `loops/{id}`.

Plus the **third agent read endpoint** (after messages pull and loop state): the driver
must list ideas at loop start to pick one.

User writes (accept / reject / reorder / add their own) go through the existing
`/v1/u/teams/:teamId/projects/:slug/...` ID-token + membership path. Like user message
send — and unlike vision editing — these writes deliberately do **not** call
`assertWebEditable`: steering must work *while* the loop owns the project; that is the
whole point of the veto.

No `firestore.rules` change: the recursive `match /projects/{slug}/{document=**}`
already grants member-read / client-write-deny to `ideas/{id}`. Rules **tests** only.

## Domain model

```
teams/{teamId}/projects/{slug}/
  └─ ideas/{ideaId}   { title, rationale?, status, order, by,
                        originLoopId?, builtInLoopId?,
                        createdAt, updatedAt, decidedAt? }   NEW
```

**Idea** — one candidate improvement to the product.
- `ideaId`: client-supplied, `idPattern`-checked at the route (kebab slug, e.g.
  `idea-dark-mode`).
- `title` (required on create): short imperative summary.
- `rationale?`: why this idea — what was learned that suggests it (markdown/text).
- `status` (required on create): enum `proposed | accepted | rejected | done`.
  - `proposed` — the loop (or user) suggested it; buildable under autonomous-with-veto.
  - `accepted` — the user explicitly endorsed it; picked before any `proposed` idea.
  - `rejected` — the user vetoed it; the loop must never build it.
  - `done` — a loop shipped it (`builtInLoopId` says which).
- `order` (required on create): integer priority within its status band (lower = first).
  The user reorders by re-writing `order`.
- `by`: `"agent" | "user"` — who created it. Server-stamped from the write path (agent
  key path ⇒ `"agent"`, `/v1/u/` path ⇒ `"user"`), **not** client-supplied.
- `originLoopId?`: the loop whose learnings produced it (free reference, unvalidated —
  same rationale as `bug.scenarioId`).
- `builtInLoopId?`: the loop that shipped it (free reference).
- Server-stamped: `createdAt` (create only), `updatedAt` (every write), `decidedAt`
  (stamped the **first** time status becomes `accepted` or `rejected`, never
  overwritten — mirrors `bug.fixedAt`).

## API

**Agent (API key, `requireApiKeyMember`)** — project-direct only:
- `PUT /v1/teams/:teamId/projects/:slug/ideas/:ideaId` — idempotent upsert.
  Required-on-create: `title`, `status`, `order`. Response `{ ok: true }`.
- `GET /v1/teams/:teamId/projects/:slug/ideas` — list all ideas, ordered by
  `status` band (accepted, proposed, rejected, done) then `order` then `createdAt`.
  Response `{ ok: true, ideas: [...] }` with server timestamps serialized like the
  messages GET. No query params (the agent filters client-side; idea counts are small).

**User (ID token, member)** — mirrors the agent PUT on the `/v1/u/` subtree:
- `PUT /v1/u/teams/:teamId/projects/:slug/ideas/:ideaId` — same body/semantics,
  `by: "user"` on create. **No `assertWebEditable`** (see Architecture).

Mount order in `app.ts`: `…/ideas` goes with the other project-direct entity mounts
(before `/` projects); the `/v1/u/` mount goes beside the existing user vision mounts.

## Service layer

**`functions/src/services/ideas.ts` (NEW)** — `upsertIdea(teamId, slug, ideaId, body,
by)` + `listIdeas(teamId, slug)`:
- `upsertIdea`: verify the project exists (404 otherwise); `creating = !snap.exists`;
  if creating and (`title` or `status` or `order` undefined) ⇒ 400
  `"title, status and order are required when creating an idea"`. Set provided fields
  only; on create stamp `createdAt`, `by`, `decidedAt: null`; always stamp `updatedAt`;
  when the resulting status is `accepted` or `rejected` and `decidedAt` is not already
  set, stamp it. `set(..., { merge: true })`, no transaction.
- `listIdeas`: single collection read, sort in memory (status band → order →
  createdAt). Ideas are tens, not thousands; no composite index (consistent with the
  existing YAGNI-on-indexes decision).

## Validation (`functions/src/schemas.ts`)

```ts
const ideaStatus = z.enum(["proposed", "accepted", "rejected", "done"]);
export const ideaBody = z.object({
  title: z.string().min(1).optional(),       // required-on-create in the service
  rationale: z.string().max(CONTENT_MAX_BYTES, "idea.rationale exceeds 100KB").optional(),
  status: ideaStatus.optional(),             // required-on-create in the service
  order: z.number().int().optional(),        // required-on-create in the service
  originLoopId: id.optional(),
  builtInLoopId: id.optional(),
});
export type IdeaBody = z.infer<typeof ideaBody>;
```

`by` is **not** in the body (server-owned, derived from the auth path). Plain
`z.object` drops it if a client sends it.

## CLI (`autoloop`)

Project-level (no `loopSeg`):
- `autoloop idea add <ideaId> --title "<t>" [--rationale "<r>"|--rationale-file <p>]
  [--status proposed] [--order <n>] [--origin-loop <loopId>]` — PUT; defaults
  `--status proposed`, `--order 100`.
- `autoloop idea set <ideaId> [--status done] [--built-in-loop <loopId>] [--title …]
  [--order …] [--rationale …]` — partial PUT.
- `autoloop idea list` — GET, print one line per idea: `[status] order ideaId — title`
  (reuse the `fetchJson` helper added for `messages pull`).
- `idea` is a two-word verb group (like `bug add`/`bug set`). Best-effort semantics
  unchanged. Sync the three CLI copies via `scripts/sync-autoloop-cli.sh`.

## Web

New **Ideas tab** in `ProjectDetail` (after Bugs): `tabs/IdeasTab.tsx`.
- `useIdeas(teamId, slug)` Firestore listener hook (project-level, like `useBugs`).
- Pure `ideasView.ts`: band-sort (accepted → proposed → rejected → done, then order,
  then createdAt) shared by tab and tests.
- Each row (`IdeaItem`): status chip, title, rationale (markdown, collapsible), origin/
  built-in loop references, and — for `proposed`/`accepted` — **Accept**, **Reject**,
  and ↑/↓ reorder buttons (swap `order` with the neighbor). Buttons call
  `putUserIdea(...)` in `dashboard/api.ts` (the `/v1/u/` PUT).
- An **add idea** form (title + rationale) so the user can seed ideas; created with
  `status: proposed` (the loop treats user-proposed and agent-proposed alike — the user
  expresses priority via Accept/reorder).
- LoopSelector hidden on the Ideas tab (project-level data, like Messages).

## Driver skill (`plugins/autoloop/skills/autoloop/SKILL.md`)

Replace the prose-only "generate 5 new improvement ideas" instruction in Step 3b:
1. **At loop close:** generate ≥5 improvement ideas from what was built and learned;
   `autoloop idea add` each (status `proposed`, rationale = the learning that produced
   it, `--origin-loop <loopId>`). Skip ideas semantically duplicating an existing
   non-rejected idea (`idea list` first).
2. **At next loop start:** `autoloop idea list`; pick the first `accepted` idea, else
   the first `proposed` (by order). **Never build a `rejected` idea.** The chosen
   idea's title/rationale seed the loop's `--goal` and plan.
3. **When the idea ships** (its loop closes with its scenarios met):
   `autoloop idea set <id> --status done --built-in-loop <loopId>`.

Plugin version bump; sync `web/public/skill/autoloop/SKILL.md`.

## Testing

- **API (Supertest + emulator):** idea upsert — required-on-create trio, partial
  update, `decidedAt` stamped once on first accept/reject and stable across re-PUTs,
  status enum rejection, 404 on missing project, `by` stamped `"agent"` on the key path
  and `"user"` on the `/v1/u/` path (and a client-supplied `by` ignored), GET list
  ordering (band → order → createdAt). `/v1/u/` PUT: member 200, non-member 403, works
  while `visionOwner === "loop"`.
- **Rules:** member-read / non-member-deny / client-write-deny on
  `projects/{slug}/ideas/{id}`.
- **CLI:** `idea add` (defaults), `idea set`, `idea list` URL/body construction.
- **Web (vitest):** `ideasView` sort; IdeasTab render (chips, bands), Accept/Reject
  calls the user API, add-idea form posts.

## Back-compat

Purely additive: projects with no ideas render an empty tab; no existing route, doc
shape, or rules behavior changes.

## Out of scope (separate specs / future)

- Vision growth diffs (`visionChanges`) — its own spec; an accepted idea often *leads*
  to a vision change, but the entities are independent.
- Notifications on idea proposal (could ride the existing notifier later).
- Cross-project idea sharing; idea comments/threads (the Messages tab covers dialogue).

## Success criteria

- The loop can propose ideas, list them, and pick the next one per the
  accepted-first/never-rejected rule; choices survive session death.
- The user can accept, reject, reorder, and add ideas from the dashboard while a loop
  is running; a rejected idea is never built.
- All suites green; three CLI copies identical; no rules change.
