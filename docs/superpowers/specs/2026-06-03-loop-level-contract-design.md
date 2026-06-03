# Daloop — Loop level (contract v2) design spec

**Date:** 2026-06-03
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** v2.1 — the **contract** for inserting a `loop` level between project and
phase: `project → loop → phase → task → commit`. The foundation the rest of v2
(v2.2 tracking UI, v2.3 notifications, v2.4 driver/skill) consumes. Backend + CLI +
rules-tests + validation only; UI/notifications/driver are their own specs.

## Goal

A project is long-lived and may be built by **multiple loop runs over time**. Today
phases/tasks/scores hang directly off the project, so a second run piles into one flat
list. This inserts a **loop** level: each loop is one run with its own phases → tasks →
commits and its own scores/testRuns/revisions, plus a `goal` (the run's objective) and
a status/lifecycle. The project keeps the **enduring vision** (goals/scenarios/
documents); a loop builds toward it and may amend it. Existing project-direct data
keeps working as an implicit `main` loop (no migration).

## Architecture

**Additive + back-compatible, mirroring the #1 commit-relocation pattern.** A new
`Loop` entity and a **loop-scoped route subtree** (`…/projects/:slug/loops/:loopId/…`)
are added; the existing **project-direct routes are retained** (they write the
project-direct collections, which readers treat as the implicit `main` loop). The
entity services become **base-path-aware** — given an optional `loopId`, they operate
under `projects/{slug}/loops/{loopId}/…`; without it, under `projects/{slug}/…`
(legacy). No data migration; `loopexp` and any existing project keep rendering as their
`main` loop.

The Firestore rules need **no change**: the recursive `match /projects/{slug}/{document=**}`
already grants member-read / client-write-deny to `loops/{id}/…` and everything under
it. We add rules **tests** only.

## Domain model

```
Project (existing doc; server adds currentLoopId)
├─ Vision (project-level, enduring — UNCHANGED): Goal[], Scenario[], Document[]
└─ loops/{loopId}            { goal, name?, order, status, startedAt, endedAt }   NEW
     ├─ phases/{phaseId}     { name, order, status }
     │   └─ tasks/{taskId}   { phaseId, title, order, status, scenarioIds[] }
     │       └─ commits/{sha}
     ├─ scores/{id} / testRuns/{id} / revisions/{id}   (this run's evaluation)
     └─ (server-derived on the loop doc) currentPhaseId, currentTaskId
```

- **Loop** — one run. `goal` (required on create): a short objective string for the run
  (distinct from the project's vision `Goal[]` entities — disambiguated as "the loop's
  goal"). `status` reuses the 7-state enum; `startedAt`/`endedAt` stamped like phases.
- **Phases/tasks/commits/scores/testRuns/revisions** — identical shapes to #1, but
  nested under a loop. Scores/testRuns/revisions reference the **project-level**
  `scenarioId` (the vision is shared).
- **Vision (goals/scenarios/documents)** stays project-level and is **amendable**: a
  loop (its driver) edits the project's goals/scenarios via the **existing
  project-level upserts** — no new surface. Amendments are permanent, shared by future
  loops.
- **Implicit `main` loop (back-compat):** a project's pre-v2 project-direct
  `phases/tasks/scores/…` are **not migrated**; readers synthesize a loop named `main`
  from them. The server's loop derivation only considers explicit `loops/{id}` docs.

### Derived fields

- **`project.currentLoopId`** (new, server-derived): the lowest-`order` non-terminal
  explicit loop; tiebreak by id; **null** if there are no non-terminal explicit loops.
  (It does NOT point at the implicit `main` loop — `main` is a reader synthesis.)
  Recomputed on every loop upsert (reuse `computeCurrentPhaseId`'s shape via a shared
  `computeCurrent` helper in `derive.ts`).
- **Per-loop `currentPhaseId` / `currentTaskId`** (stored on the **loop** doc):
  recomputed within that loop on its phase/task writes, exactly mirroring today's
  project-level derivation but scoped to the loop's phase/task sets. For project-direct
  (legacy `main`) writes, the existing project-doc `currentPhaseId`/`currentTaskId`
  continue to be maintained as today (so legacy projects are unchanged).

### Per-loop scenario.state (reader rule, restated for v2)

Computed by readers within a loop: for a scenario, take the latest-by-id score and
testRun **in that loop**; `met` iff composite ≥ threshold (default 80) AND
testRun.failed == 0. "N/M met" is per-loop (the headline is the current/selected loop).
(This is a reader concern — v2.1 just stores per-loop scores; v2.2 renders the state.)

## API

All under the existing `/v1/teams/:teamId/projects/:slug` subtree (`requireApiKeyMember`).

**New loop entity (idempotent PUT):**
- `PUT …/loops/:loopId` — required-on-create: `goal` + `order` + `status`. Recomputes
  `project.currentLoopId`.

**New loop-scoped run data (reuse the #1 schemas + base-path-aware services):**
- `PUT …/loops/:loopId/phases/:phaseId`
- `PUT …/loops/:loopId/tasks/:taskId` (recomputes the **loop's** currentTaskId)
- `PUT …/loops/:loopId/tasks/:taskId/commits/:sha`
- `POST …/loops/:loopId/scores | testRuns | revisions`
- A loop's phase upsert recomputes the loop's `currentPhaseId` + `currentTaskId`.

**Retained legacy (project-direct) routes** — unchanged, write project-direct (= the
`main` loop): `…/phases/:phaseId`, `…/phases/:phaseId/commits/:sha`, `…/tasks/:taskId`,
`…/tasks/:taskId/commits/:sha`, `…/scores|testRuns|revisions`, and the project/goals/
scenarios/documents routes (vision is project-level, unchanged). The `/v1/u/…` user
write path (#5) is unaffected (it edits the project-level vision).

**Base-path-aware services:** refactor the existing `upsertPhase/upsertTask/
upsertTaskCommit/appendScore/…` to take an optional `loopId` (or a resolved base
DocumentReference). With `loopId`: operate under `loops/{loopId}` and derive on the
loop doc. Without: today's project-direct behavior. DRY — one code path, two mounts.

## CLI (`daloop`)

- `daloop loop start <loopId> --goal "<objective>" --order <n> [--status running]` —
  PUT the loop; record `cfg.currentLoopId = <loopId>` + `cfg.loops[id]`.
- `daloop loop set <loopId> --status completed` — PUT loop status.
- **Loop-aware reporting:** `phase start`, `task start/set`, `commit`, `score`,
  `test-run`, `revise` now target the **current loop** when `cfg.currentLoopId` is set
  (URL includes `/loops/<id>`); when it is NOT set, they use today's project-direct
  URLs (legacy `main` loop) — exactly the back-compat shape. (`commit`'s implicit-`main`
  *task* behavior from #1 is preserved within whichever loop scope is active.)
- `daloop init` seeds `currentLoopId: null, loops: {}` alongside the existing config.
- Best-effort semantics unchanged (exit 0 unless `--strict`).

## Validation

zod `loopBody`: `goal` (string, min 1) optional at schema level (required-on-create in
the service), `name?`, `order` int, `status` enum, `scenarioIds?` not needed. `loopId`
matches `idPattern`. All other bodies reuse #1's schemas unchanged.

## Back-compat (the one wrinkle, stated fully)

- **Reads:** a reader lists `loops/{id}` (explicit) and, if the project has project-direct
  `phases`/`tasks`, synthesizes a `main` loop from them. v2.2 (UI) implements the
  synthesis; v2.1 just preserves both shapes.
- **Writes:** legacy clients (no `--loop`/`currentLoopId`) keep hitting the
  project-direct routes — unchanged behavior, unchanged data location. Loop-aware
  clients write under `loops/{id}/…`.
- **No migration.** Existing `currentPhaseId`/`currentTaskId` on project docs remain
  valid for the `main` loop.

## Testing

- **API (Supertest + emulator):** loop entity upsert (required-on-create, currentLoopId
  derivation incl. advance-on-complete + null-when-all-terminal); loop-scoped phase/task
  (per-loop currentPhaseId/currentTaskId), task commit, score/testRun/revision under a
  loop; the **legacy project-direct routes still pass unchanged** (existing
  phases/tasks/commits/events tests remain green — the base-path refactor must not
  regress them).
- **Rules:** add tests asserting member-read / non-member-deny / client-write-deny on
  `loops/{id}` and `loops/{id}/phases|tasks|scores|…` (no rules change — recursive match).
- **CLI:** `loop start/set`; loop-aware `task start`/`commit`/`score` build
  `…/loops/<id>/…` URLs when `currentLoopId` is set, and project-direct URLs when not;
  `daloop init` seeds the new config fields. Update the existing CLI tests that assume
  project-direct only where the current-loop path changes them.
- `functions` build clean; all suites green.

## Out of scope (separate v2 specs)

- **v2.2** tracking UI (render loops, the `main` synthesis, per-loop state + headline).
- **v2.3** notifications scoped per `(loop, scenario)`.
- **v2.4** `/daloop` driver + reporting-skill updates (`loop start` at run start).
- Cross-loop rollups / "best across loops" (deferred; per-loop is the model).

## Success criteria

- A client can create a loop (`goal`+order+status), report its phases→tasks→commits and
  scores/testRuns/revisions under it, and the server derives `project.currentLoopId` +
  the loop's `currentPhaseId`/`currentTaskId`.
- Multiple loops on one project keep their run data fully separate.
- Existing project-direct projects (e.g. `loopexp`) are unchanged and still readable as
  the `main` loop; all #1 API/rules/CLI tests stay green (no regression from the
  base-path refactor).
- Rules unchanged; new nested paths are member-readable + client-write-denied (tested).
- `daloop loop start` + loop-aware reporting work; legacy reporting (no loop) still
  writes project-direct.
