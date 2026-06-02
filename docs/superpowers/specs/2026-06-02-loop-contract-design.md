# Daloop — Loop Contract (domain model + reporting interface) design spec

**Date:** 2026-06-02
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** #1 of the "vision-driven loop" initiative. This spec defines the
**shared spine** every other piece builds on. Deferred to their own specs:
the vision-authoring skill, the loop-driver skill, and the website tracking UI.

## Goal

Today Daloop tracks `team → project → phase → commit` with a 7-state status, via a
write-only API that agents call and a read-only website. We are expanding Daloop
into a **vision-driven, self-evaluating development loop**: the user (with AI help)
authors a **vision** (goals, scenarios, a scoring rubric, and test automation); the
AI turns it into a **holistic plan** and iterates through a `phases → tasks →
commits` hierarchy; after each task it re-tests and re-scores the scenarios it
advanced and, when quality is short, **revises the task path**. The skill sets up
and drives the loop locally (in Claude Code); the website tracks it and hosts the
readable vision/documents.

This spec covers **only the contract**: the domain model, the API surface, the CLI
surface, the security-rules read-extension, validation, and tests. It does **not**
cover the skill or the website (separate specs that consume this contract).

## Architecture

Unchanged from today's shape: **the loop owns its canonical state locally and
reports one-way to Daloop via the write-only API (per-user API key → team
membership). Daloop stores it for reading + tracking; the website reads via
Firestore listeners.** The agent computes everything (runs tests, self-scores,
decides revisions); **Daloop only records.** Reporting is **best-effort** — a failed
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
   Daloop only records. All revisions are preserved.
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

Event ids are server-generated (e.g. a sortable ULID/auto id); `createdAt` is
server-stamped. The server continues to own derived `currentPhaseId` and now
`currentTaskId` (lowest-order non-terminal task of the current phase).

## API

All under the existing `/v1/teams/{teamId}/projects/{slug}` subtree, guarded by the
existing `requireApiKeyMember` middleware (per-user API key → team membership).

**Entities — idempotent `PUT` (client-supplied id):**
- `PUT …/goals/:goalId`
- `PUT …/scenarios/:scenarioId`
- `PUT …/tasks/:taskId`
- `PUT …/tasks/:taskId/commits/:sha`   (commit, now task-scoped)
- `PUT …/documents/:docId`
- (existing `PUT …` project, `…/phases/:phaseId` retained unchanged)

**Events — append `POST` (server stamps id + `createdAt`):**
- `POST …/scores`
- `POST …/testRuns`
- `POST …/revisions`

Responses follow the existing uniform envelope (`{ ok: true }` / error
`{ error: { code, message } }`). The server recomputes `currentPhaseId` /
`currentTaskId` on relevant writes.

## CLI (`daloop`)

New verbs (all best-effort; exit 0 on reporting failure unless `--strict`):
```
daloop vision import --file vision.json        # bulk upsert goals + scenarios (+ docs)
daloop goal set <id> --title … --order <n>
daloop scenario set <id> --goal <g> --title … --order <n> [--threshold 80] --rubric rubric.json
daloop task start <id> --phase <p> --name … --order <n> --scenarios a,b
daloop task set <id> --status completed
daloop commit [--task <id>]                     # existing; task-aware (see back-compat)
daloop score <scenarioId> --task <t> --criterion correctness=4 --criterion ux=3 [--commit <sha>] [--note …]
daloop test-run <scenarioId> --task <t> --passed 8 --failed 1 [--issue "…"]…
daloop revise --scenario <s> --reason "…" --change add:<taskId> --change drop:<taskId>…
daloop doc add --kind vision --title "…" (--file path | --url https://…)
```

**Back-compat:** commits nest under a task, but today's `daloop commit` reports
phase-level commits. When `--task` is omitted, the CLI auto-attaches to an implicit
default task (e.g. `main`) for the current phase, creating it if needed — so simple
loops keep working while the model stays clean. The existing `project set` and
`phase start/set` commands are unchanged.

## Security rules

Extend the existing `isMember(teamId)` read pattern to the new subcollections
(`goals`, `scenarios`, `tasks` and their `commits`, `scores`, `testRuns`,
`revisions`, `documents`). All writes stay `false` for clients (Admin-SDK API only),
consistent with today. No change to the `members`/`invites`/`users`/`apiKeys` rules.

## Validation

zod schemas (mirroring today's style):
- `status` ∈ `queued|running|blocked|paused|completed|failed|cancelled`.
- ids (`goalId`, `scenarioId`, `taskId`, `phaseId`, `docId`) match `^[a-z0-9._-]+$`;
  commit `sha` matches the existing sha pattern.
- rubric: `criteria[]` each `{ id matches id-pattern, name non-empty, weight > 0,
  max ≥ 1 }`; `score.criteria` values are integers `0..max`; `composite` is `0..100`.
- `threshold` (if present) `0..100`.
- `testRun.passed/failed` ≥ 0; `issues[]` are strings.
- `document.format` ∈ `markdown|url`; oversize bodies → 400 (existing 256kb limit).

## Error handling

- API: invalid input → 400 with the uniform error envelope; missing team/project →
  404; auth failures via the existing middleware (401/403). Unhandled errors → 500
  and logged (existing behavior).
- CLI: best-effort — reporting failures print a warning and exit 0 unless `--strict`
  (or `DALOOP_STRICT=1`), matching the current CLI.

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
