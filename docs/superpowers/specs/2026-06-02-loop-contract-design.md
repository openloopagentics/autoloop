# Autoloop — Loop Contract (domain model + reporting interface) design spec

**Date:** 2026-06-02
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** #1 of the "vision-driven loop" initiative. This spec defines the
**shared spine** every other piece builds on. Deferred to their own specs:
the vision-authoring skill, the loop-driver skill, and the website tracking UI.

## Goal

Today Autoloop tracks `team → project → phase → commit` with a 7-state status, via a
write-only API that agents call and a read-only website. We are expanding Autoloop
into a **vision-driven, self-evaluating development loop**: the user (with AI help)
authors a **vision** (goals, scenarios, a scoring rubric, and test automation); the
AI turns it into a **holistic plan** and iterates through a `phases → tasks →
commits` hierarchy; after each task it re-tests and re-scores the scenarios it
advanced and, when quality is short, **revises the task path**. The skill sets up
and drives the loop locally (in Claude Code); the website tracks it and hosts the
readable vision/documents.

This spec covers **only the contract**: the domain model, the API surface, the CLI
surface, the security-rules tests (no rules change — see that section), validation,
and tests. It does **not**
cover the skill or the website (separate specs that consume this contract).

## Architecture

Unchanged from today's shape: **the loop owns its canonical state locally and
reports one-way to Autoloop via the write-only API (per-user API key → team
membership). Autoloop stores it for reading + tracking; the website reads via
Firestore listeners.** The agent computes everything (runs tests, self-scores,
decides revisions); **Autoloop only records.** Reporting is **best-effort** — a failed
report never blocks the loop (exit 0 unless `--strict`).

Two write shapes:
- **Entities** — idempotent `PUT` keyed by a client-supplied id (goals, scenarios,
  tasks, commits, documents). Re-reporting is safe.
- **Events** — append-only `POST`; the server stamps the id and `at` timestamp
  (scores, test runs, revisions). These form the loop's replayable history.

## Domain model

Hierarchy (all under `teams/{teamId}/projects/{slug}`):

```
Project
├─ Vision (readable artifacts)
│   ├─ Goal[]            { id, title, description, order }
│   └─ Scenario[]        { id, goalId, title, description, order, threshold?,
│                          rubric:{ criteria:[{ id, name, weight, max }] } }
│       └─ state         met | unmet   ← DERIVED at read time (not stored)
├─ Plan
│   ├─ Phase[]           { id, name, order, status }              (exists today)
│   └─ Task[]            { id, phaseId, title, order, status, scenarioIds[] }   NEW
│       └─ Commit[]      { sha, message, author, committedAt }    (commits move under tasks)
├─ Events (append-only — the loop's history)
│   ├─ Score             { id, scenarioId, taskId, commitSha?, at, criteria{id:val}, composite, by:"ai", note? }
│   ├─ TestRun           { id, scenarioId, taskId, at, passed, failed, issues[] }
│   └─ Revision          { id, at, trigger:{ scenarioId, reason }, changes[]:{ op:add|replace|reorder|drop, taskId, … } }
└─ Document[]            { id, kind, title, format: markdown|url, content, at }
```

### Entity semantics

- **Goal** — a high-level outcome. Ordered for display.
- **Scenario** — the acceptance unit, nested under a goal. Carries its own
  **rubric** (named, weighted criteria, each scored `0..max`) and an optional
  per-scenario `threshold` (global default **80**). Its test definitions live as a
  `Document` (kind `test-spec`) the agent runs; results are reported as `TestRun`
  events.
- **Phase** — unchanged (name, order, 7-state status).
- **Task** — NEW layer between phase and commit. References the scenario(s) it
  advances via `scenarioIds[]`. Reuses the 7-state status enum.
- **Commit** — now nested under a task (`tasks/{taskId}/commits/{sha}`).

### Evaluation & the adaptive loop (semantics the contract must support)

1. After a task's commits, the agent — for each scenario the task advances — runs
   the scenario's tests (→ `TestRun` event) and self-evaluates against the rubric
   (→ `Score` event with per-criterion values + weighted composite normalized to
   **0–100**).
2. **Derived `scenario.state`** (computed by readers, never stored): **met** iff the
   latest `Score.composite ≥ threshold` AND the latest `TestRun.failed == 0`;
   otherwise **unmet**.
3. **Revision** — when a targeted scenario is still unmet after evaluation, the loop
   records a `Revision` event capturing the trigger (scenario + reason) and the
   task-path `changes[]` (`add` / `replace` / `reorder` / `drop`). The agent decides;
   Autoloop only records. All revisions are preserved.
4. **Progress** — the project trends toward done as scenarios flip to *met*;
   "N/M scenarios met" is the headline health signal. Task/phase statuses use the
   existing enum.

## Storage (Firestore)

Extend `teams/{teamId}/projects/{slug}`:

```
projects/{slug}                       (existing doc; server keeps currentPhaseId,
                                        adds currentTaskId)
  goals/{goalId}                      { title, description, order }
  scenarios/{scenarioId}              { goalId, title, description, order, threshold?,
                                        rubric:{ criteria:[{id,name,weight,max}] } }
  phases/{phaseId}                    { name, order, status }            (exists)
  tasks/{taskId}                      { phaseId, title, order, status, scenarioIds[] }
  tasks/{taskId}/commits/{sha}        { message, author, committedAt }
  scores/{id}                         { scenarioId, taskId, commitSha?, criteria{id:val},
                                        composite, by, note?, createdAt }      append-only
  testRuns/{id}                       { scenarioId, taskId, passed, failed, issues[], createdAt }  append-only
  revisions/{id}                      { trigger:{scenarioId,reason}, changes[], createdAt }        append-only
  documents/{id}                      { kind, title, format, content, createdAt }
```

### Event ordering & ids

Event ids (`scores`, `testRuns`, `revisions`) are **server-generated, sortable
ULID-style strings** built in the service layer as `<48-bit ms timestamp,
base32>` + `<random suffix from node:crypto.randomBytes>` — a small new server-side
generator (no new dependency; `apiKeys.ts` already imports `randomBytes` from
`node:crypto` for keys, but has no ULID helper to reuse). `Date.now()` is fine in
`functions/src` — the no-`Date.now()` convention applies only to the throwaway
`prototype/`). This gives a **total order even for events committed in the same
millisecond**. `createdAt` is also stored (`FieldValue.serverTimestamp()`) for
display, but **replay/ordering uses the id** (`orderBy(documentId ASC)`), never the
timestamp. Firestore auto-ids are *not* used for events (not time-sortable).

### Derived `scenario.state`

Computed by readers (website), never stored. For a scenario, fetch its `scores` and
`testRuns` (filtered by `scenarioId`) and take the **latest by id** (the ULID order
above). `state = met` iff `latestScore.composite ≥ threshold` AND
`latestTestRun.failed == 0`; else `unmet`. At current scale readers fetch the
(small) event set and pick the max id in memory — **no composite index required**.
If event volume grows, the fallback is composite indexes
(`scenarioId ASC, __name__ DESC`) on `scores` and `testRuns`; this is a tuning step,
not part of this spec.

### Derived `currentPhaseId` / `currentTaskId`

The server owns both, recomputed on writes:
- `currentPhaseId` (existing): lowest-`order` non-terminal phase; tiebreak by
  `phaseId`. Null if all phases are terminal.
- `currentTaskId` (new): among tasks where `phaseId == currentPhaseId`, the
  lowest-`order` non-terminal task; tiebreak by `taskId`. **Null** if
  `currentPhaseId` is null or that phase has no non-terminal task.
- Recompute triggers: a **task** upsert recomputes `currentTaskId`; a **phase**
  upsert recomputes `currentPhaseId` **and** `currentTaskId` (because the current
  phase may have moved). Both mirror the existing `upsertPhase` derivation in
  `services/phases.ts`.

## API

All under the existing `/v1/teams/{teamId}/projects/{slug}` subtree, guarded by the
existing `requireApiKeyMember` middleware (per-user API key → team membership).

**Entities — idempotent `PUT` (client-supplied id):**
- `PUT …/goals/:goalId`
- `PUT …/scenarios/:scenarioId`
- `PUT …/tasks/:taskId`
- `PUT …/tasks/:taskId/commits/:sha`   (commit, now task-scoped)
- `PUT …/documents/:docId`
- (existing `PUT …` project and `…/phases/:phaseId` retained unchanged; the legacy
  `PUT …/phases/:phaseId/commits/:sha` is **retained, deprecated** for back-compat)

**Required-on-create** (idempotent `PUT` creates if absent, patches if present —
mirroring `services/projects.ts` / `phases.ts`): goal → `title`; scenario →
`goalId` + `title` + `rubric`; task → `phaseId` + `title` + `order` + `status`;
document → `kind` + `title` + `format` + `content`. On update these are optional;
server-owned/derived fields are never client-settable.

**Events — append `POST` (server stamps id + `createdAt`):**
- `POST …/scores`
- `POST …/testRuns`
- `POST …/revisions`

Responses follow the existing uniform envelope (`{ ok: true }` / error
`{ error: { code, message } }`). The server recomputes `currentPhaseId` /
`currentTaskId` on relevant writes.

## CLI (`autoloop`)

New verbs (all best-effort; exit 0 on reporting failure unless `--strict`):
```
autoloop vision import --file vision.json        # bulk upsert goals + scenarios (+ docs)
autoloop goal set <id> --title … --order <n>
autoloop scenario set <id> --goal <g> --title … --order <n> [--threshold 80] --rubric rubric.json
autoloop task start <id> --phase <p> --name … --order <n> --scenarios a,b
autoloop task set <id> --status completed
autoloop commit [--task <id>]                     # existing; task-aware (see back-compat)
autoloop score <scenarioId> --task <t> --criterion correctness=4 --criterion ux=3 [--commit <sha>] [--note …]
autoloop test-run <scenarioId> --task <t> --passed 8 --failed 1 [--issue "…"]…
autoloop revise --scenario <s> --reason "…" --change add:<taskId> --change drop:<taskId>…
autoloop doc add --kind vision --title "…" (--file path | --url https://…)
```

**Back-compat (commit relocation):** in the new model commits nest under
`tasks/{taskId}/commits/{sha}`, but today commits live at
`phases/{phaseId}/commits/{sha}` and the deployed CLI/skill report there. To avoid
breaking anything:

- **The legacy phase-scoped commit route and storage are retained, unchanged but
  deprecated** (`PUT …/phases/:phaseId/commits/:sha`, mounted as today in `app.ts`).
  Already-written `phases/*/commits/*` docs stay valid and readable; the existing
  `commits.test.ts` and the `phases/p1/commits/abc` seed in `rules.test.ts` keep
  passing. No migration of old data.
- **The forward path is task-scoped** (`PUT …/tasks/:taskId/commits/:sha`). The
  updated `autoloop commit` targets a task: with `--task <id>` it uses that task; with
  no `--task` it uses `cfg.currentTaskId` if set, else **auto-creates an implicit
  default task** and uses it.
- **Implicit default task shape** (when auto-created): id `main`, `phaseId =
  cfg.currentPhaseId` (error if there is no current phase — same as today's commit
  requiring a current phase), `title "Main"`, `order 0`, `status "running"`,
  `scenarioIds []`. It is a normal task doc, so it satisfies task validation.
- The website reads commits under tasks for loop-mode projects; legacy phase-mode
  projects (commits under phases) still render via the retained path.

The existing `project set` and `phase start/set` commands are unchanged.

## Security rules

**No rules change is required.** The existing `match /projects/{slug}` block already
contains a recursive wildcard that grants member read to every nested doc and
forbids all client writes:

```
match /projects/{slug} {
  allow read: if isMember(teamId);
  allow write: if false;
  match /{document=**} { allow read: if isMember(teamId); allow write: if false; }
}
```

This already covers `goals`, `scenarios`, `tasks` (and their `commits`), `scores`,
`testRuns`, `revisions`, and `documents` — they are member-readable and
client-write-forbidden today. We only **add rules tests** asserting member-read /
non-member-deny / client-write-deny on the new paths (no new `match` blocks — adding
sibling blocks could shadow or duplicate the recursive rule).

## Validation

zod schemas (mirroring today's style):
- `status` ∈ `queued|running|blocked|paused|completed|failed|cancelled`.
- ids (`goalId`, `scenarioId`, `taskId`, `phaseId`, `docId`) match `^[a-z0-9._-]+$`;
  commit `sha` validates with the shared id pattern (as commits do today).
- rubric: `criteria[]` each `{ id matches id-pattern, name non-empty, weight > 0,
  max ≥ 1 }`; `composite` is `0..100`.
- `score.criteria`: zod enforces integer `≥ 0`. The per-criterion **`≤ max`** bound
  and the check that **criterion keys match the scenario's rubric ids** are enforced
  in the **service layer** (after loading the scenario), since `max`/ids live in a
  different document and a static body schema can't see them. A violation → 400.
- `threshold` (if present) `0..100`.
- `testRun.passed/failed` ≥ 0; `issues[]` are strings.
- `document.format` ∈ `markdown|url`; `document.content` field-level cap **100KB**
  (matching the existing `design.content` zod cap). The 256KB `express.json` limit is
  the whole-request body-parser cap, not the field cap; oversize → 400.

## Error handling

- API: invalid input → 400 with the uniform error envelope; missing team/project →
  404; auth failures via the existing middleware (401/403). Unhandled errors → 500
  and logged (existing behavior).
- CLI: best-effort — reporting failures print a warning and exit 0 unless `--strict`
  (or `AUTOLOOP_STRICT=1`), matching the current CLI.

## Testing

- **API**: Supertest + Firestore emulator per route group (entities upsert,
  event append, derived `currentTaskId`, validation 400s), mirroring the existing
  `functions/test` harness.
- **Rules**: `@firebase/rules-unit-testing` — a team member can read each new
  subcollection; a non-member cannot; clients cannot write.
- **CLI**: end-to-end against the API + emulator (vision import, task start, score,
  test-run, revise, doc add, and `commit` auto-task back-compat).

## Out of scope (separate specs)

- Vision-authoring skill (interview → `vision.json`).
- Loop-driver skill (plan generation, iteration, self-scoring, revision decisions).
- Website tracking UI (render vision/docs, phase→task tree, score charts, revision
  timeline, scenarios-met headline).

## Success criteria

- A loop can push: a full vision (goals + scenarios + rubrics) and documents; a
  plan (phases + tasks); task-scoped commits; and score / test-run / revision events.
- Team members can read all of it; a reader can derive `scenario.state` and replay
  the event history in order.
- Existing `project set` / `phase` / `commit` reporting keeps working (back-compat).
- Reporting stays best-effort.
- API (Supertest+emulator), rules, and CLI e2e suites are green; `npm run build`
  clean for `functions`.
