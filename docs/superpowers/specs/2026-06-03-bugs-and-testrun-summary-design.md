# Daloop — Bug entity + test-run summaries (contract) design spec

**Date:** 2026-06-03
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** the **contract** foundation for the tabs/loops/bugs UI batch. Adds a
trackable **`bug`** entity (so bugs found in testing are tracked separately with an
open/fixed lifecycle and viewable on their own tab) and an optional **`summary`** field
on the `testRun` event (so the loop can upload a human-readable run summary). Backend +
CLI + rules-tests + validation only. The tabbed UI (Dashboard/Vision/Loops/Bugs,
rollups, in-progress prominence, only-current-is-live) and the `/daloop` driver hygiene
(task-status transitions, reporting bugs/summaries) are their own specs and consume this.

## Goal

When a loop runs tests it finds bugs. Today the only record is `testRun.issues[]` — a
per-run string array with no lifecycle: you cannot tell whether issue X from run 3 was
fixed by run 7, and there is no project-wide list. This spec makes a **bug** a
first-class, idempotent, trackable entity (`open` → `fixed`) that the loop reports as it
discovers and resolves them, so the dashboard can show a dedicated Bugs view. It also
lets the loop attach a `summary` (markdown/text) to a test run, so the loop detail view
can show *what the run actually exercised and concluded*, not just pass/fail counts.

## Architecture

**Additive + back-compatible, mirroring the loop-level contract (v2.1).** Two changes:

1. A new **`bug` entity** with an **idempotent PUT** (client-supplied `bugId`), made
   **base-path-aware** exactly like the other run data: given an optional `loopId` it
   lives under `projects/{slug}/loops/{loopId}/bugs/{bugId}`; without it, under
   `projects/{slug}/bugs/{bugId}` (the implicit `main` loop). A bug is run data — it
   belongs to the loop that found it — so it follows the same base-path rule as
   phases/tasks/scores/testRuns, not the project-level vision rule.
2. An optional **`summary`** field on the existing `testRun` event body + stored doc.
   Purely additive: omitting it preserves today's byte-shape (no `summary` key written).

The Firestore rules need **no change**: the recursive
`match /projects/{slug}/{document=**}` already grants member-read / client-write-deny to
`bugs/{id}` and `loops/{id}/bugs/{id}`. We add rules **tests** only.

`bug` is a plain entity (no derived state) — closer to `goal`/`document` than to
`phase`/`task`. It does **not** recompute any `currentX` field, so its service is a
straightforward `resolveBase` + merge-set, with no transaction.

## Domain model

```
loops/{loopId}            (or project-direct = main loop)
  ├─ … phases / tasks / scores / testRuns / revisions (unchanged) …
  └─ bugs/{bugId}   { title, description?, scenarioId?, taskId?, severity?, status }   NEW
```

**Bug** — one tracked defect found during the loop.
- `title` (required on create): short summary.
- `description?`: optional longer detail (markdown/text).
- `scenarioId?`: the project-level scenario it relates to (NOT validated against the
  scenario collection — kept as a free reference, like `taskId`; see note below).
- `taskId?`: the loop task during which it was found.
- `severity?`: optional enum `low | medium | high` (drives sort/filter in the view).
- `status` (required on create): enum `open | fixed`. The loop opens a bug when a test
  reveals it and re-PUTs `status: fixed` when resolved. Idempotent: re-reporting the
  same `bugId` updates in place.
- Server-stamped: `createdAt` (on create only), `updatedAt` (every write), and
  `fixedAt` (stamped the **first** time status becomes `fixed`, never overwritten —
  mirrors phase `endedAt`).

**Why `scenarioId` is unvalidated:** `appendScore` validates `scenarioId` because it
must look up the rubric to range-check criteria. A bug carries `scenarioId` only as a
display/grouping reference; validating it would force a project-level scenario read on
every bug write for no functional gain and would couple the bug entity to the vision.
Keep it a free reference (consistent with how `taskId` is already unvalidated on
events). Format is still `idPattern`-checked at the route.

**testRun.summary** — optional `summary` string (markdown/text) on the `testRun` event,
size-capped at the shared `CONTENT_MAX_BYTES` (100KB) like `document.content`. Stored on
the event doc only when provided; absent ⇒ no `summary` key (byte-identical to today).

## API

All under the existing `/v1/teams/:teamId/projects/:slug` subtree (`requireApiKeyMember`).

**New bug entity (idempotent PUT):**
- `PUT …/bugs/:bugId` — required-on-create: `title` + `status`. Project-direct (main).
- `PUT …/loops/:loopId/bugs/:bugId` — same, loop-scoped (reuses the SAME router via
  `mergeParams`, exactly like the existing loop-scoped phase/task/event mounts).

Mount order in `app.ts`: the loop-scoped `…/loops/:loopId/bugs` mount goes with the
other `…/loops/:loopId/*` mounts (before the `/:slug/loops` entity mount); the
project-direct `…/bugs` mount goes with the other project-direct entity mounts (before
`/` projects). Response: `{ ok: true }` (entity PUT shape, like tasks/phases).

**Changed event:** `testRun` body + stored doc gain optional `summary`. Routes/mounts
unchanged (the existing `…/testRuns` and `…/loops/:loopId/testRuns` mounts already
exist). Response unchanged: `{ ok: true, id }`.

## Service layer

**`functions/src/services/bugs.ts` (NEW)** — `upsertBug(teamId, slug, bugId, body, loopId?)`:
- Reuse the `resolveBase` pattern from `events.ts` (verify the project always, the loop
  when `loopId` is set; 404 `"project does not exist"` / `"loop does not exist"`).
  Factor `resolveBase` into a tiny shared helper (`services/baseRef.ts`) imported by both
  `events.ts` and `bugs.ts` rather than duplicating it — `events.ts` keeps identical
  behavior.
- `creating = !(await bugRef.get()).exists`; if creating and (`title` or `status`
  undefined) ⇒ 400 `"title and status are required when creating a bug"`.
- Build a partial: set provided fields only (drops unknown keys via zod already); on
  create stamp `createdAt` + `fixedAt: null`; always stamp `updatedAt`. When the
  resulting status is `fixed` and `fixedAt` is not already set, stamp `fixedAt`.
- `set(..., { merge: true })`. No transaction (no derived `currentX`, no
  write-write conflict — a single doc merge).

**`appendTestRun`** — add `if (body.summary !== undefined) data.summary = body.summary;`
(build the doc object first, then conditionally add `summary`, so the absent case is
byte-identical to today).

## Validation (`functions/src/schemas.ts`)

```ts
const severity = z.enum(["low", "medium", "high"]);
const bugStatus = z.enum(["open", "fixed"]);
export const bugBody = z.object({
  title: z.string().min(1).optional(),        // required-on-create in the service
  description: z.string().optional(),
  scenarioId: id.optional(),
  taskId: id.optional(),
  severity: severity.optional(),
  status: bugStatus.optional(),               // required-on-create in the service
});
export type BugBody = z.infer<typeof bugBody>;
```

`testRunBody` gains:
```ts
  summary: z.string().max(CONTENT_MAX_BYTES, "testRun.summary exceeds 100KB").optional(),
```

`bugId` is `idPattern`-checked at the route (like `taskId`/`phaseId`).

## CLI (`daloop`)

Loop-aware via the existing `loopSeg(cfg)` helper (targets the current loop when
`cfg.currentLoopId` is set, else project-direct — the back-compat shape).

- `daloop bug add <bugId> --title "<t>" [--status open] [--scenario <id>] [--task <id>]
  [--severity low|medium|high] [--description "<d>"]` — PUT the bug (default
  `--status open` on add).
- `daloop bug set <bugId> [--status fixed] [--title …] [--severity …] [--description …]`
  — PUT the bug (partial update).
- `daloop test-run … --summary "<text>"` **or** `--summary-file <path.md>` — adds
  `summary` to the test-run POST body. `--summary-file` reads the file (UTF-8); if both
  are given, `--summary-file` wins. Reuse the file-reading approach already used by
  `doc add`/`vision import` for `--*-file` flags.
- Dispatch: `bug` is a **two-word** verb group (`bug add`, `bug set`) — register it like
  `loop start`/`loop set` (NOT in the `ONE_WORD` set).
- Best-effort semantics unchanged (exit 0 unless `--strict`).
- `daloop init` config seeding is unchanged (bugs need no client config).

Sync the canonical `cli/daloop.mjs` to the plugin `bin/daloop` and
`web/public/skill/daloop.mjs` via `scripts/sync-daloop-cli.sh`.

## Rules

No rules change (recursive `match`). Add rules **tests** asserting member-read /
non-member-deny / client-write-deny on `projects/{slug}/bugs/{id}` and
`projects/{slug}/loops/{id}/bugs/{id}`.

## Testing

- **API (Supertest + emulator):** bug upsert — required-on-create (title+status),
  partial update, `fixedAt` stamped once on first `fixed` and stable across re-PUTs,
  project-direct **and** loop-scoped (404 when the loop is absent), `severity`/`status`
  enum rejection, `scenarioId` accepted without a scenario existing. testRun `summary`:
  stored when provided, **absent key when omitted** (assert the field is undefined), and
  the over-100KB rejection. Confirm the `resolveBase` extraction did not regress the
  existing score/testRun/revision tests.
- **Rules:** the new bug-path read/deny tests above.
- **CLI:** `bug add` (default status open) and `bug set` build `…/bugs/<id>` and, with a
  current loop, `…/loops/<id>/bugs/<id>` URLs; `test-run --summary` / `--summary-file`
  include `summary` in the body (and `--summary-file` precedence). Existing CLI tests
  stay green.
- `functions` build clean; all suites green; sync script run and the three CLI copies
  identical.

## Back-compat

- Purely additive. Projects with no bugs are unaffected; `testRun` without `summary` is
  byte-identical to today.
- Bugs follow the same project-direct ⇄ loop-scoped split as the rest of the run data,
  so legacy `main`-loop projects (e.g. `loopexp`) report bugs project-direct with no
  migration.

## Out of scope (separate specs)

- **Tabbed tracking UI** — Dashboard/Vision/Loops/Bugs tabs, loop selector + per-loop
  scoping, dashboard rollups (loop counts, phases done/total, status), in-progress-task
  prominence, the only-current-task-is-live render rule, the Bugs view, rendering
  `testRun.summary`. (The UI sub-project.)
- **`/daloop` driver hygiene** — marking tasks `completed`/`failed` when done, opening/
  fixing bugs, uploading test summaries, `loop start` at run start. (The driver
  sub-project.)
- **Per-loop notifications** incl. a future "bug opened" notification (v2.3).

## Success criteria

- A client can `PUT` a bug (project-direct and under a loop) with `title`+`status`,
  update it in place, and flip it to `fixed` (with a stable `fixedAt`); reads are
  member-gated and client-writes denied (tested).
- A client can attach a `summary` to a `testRun`; omitting it leaves the stored doc
  byte-identical to today.
- `daloop bug add/set` and `test-run --summary/--summary-file` work, loop-aware; the
  three CLI copies stay in sync.
- `functions` build clean; all existing API/rules/CLI suites stay green (the
  `resolveBase` extraction is non-regressing).
