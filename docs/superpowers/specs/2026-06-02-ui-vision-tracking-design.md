# Daloop — Vision Tracking UI design spec

**Date:** 2026-06-02
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** #4 (website tracking UI) of the "vision-driven loop" initiative. It
**consumes** the merged loop contract (#1) and the data the loop-driver skill (#3)
already writes; it changes no API, no CLI, and no Firestore rules.

## Goal

Today the dashboard renders only the original `project → phases → phase-commits`
model, so everything the loop now produces — goals, scenarios, rubrics, tasks,
task-scoped commits, scores, test runs, revisions, documents — is **stored but
invisible**. This sub-project adds a **read-only tracking UI** that renders the full
vision-driven loop on the existing project page: the vision and its scenarios with
their met/unmet state and latest scores, the phase→task tree with task-scoped
commits, the revision timeline, the documents, and a headline **"N/M scenarios met"**.

## Architecture

A **purely additive, read-only** layer on the existing React/Firestore dashboard.
Nothing else changes:

- **Data hooks** mirror the existing `Result<T>` + `onSnapshot` pattern in
  `web/src/dashboard/hooks.ts` (one hook per subcollection).
- A **pure derivation helper** (`web/src/dashboard/scenarioState.ts`) computes
  `scenario.state` client-side (the contract specifies readers derive it; there is no
  reader today). This is the one unit-tested unit.
- **Presentational components** under `web/src/dashboard/components/` render each
  section, composed into `ProjectDetail.tsx`.
- Loop sections render **only when their data exists**, so legacy phase-mode projects
  keep rendering exactly as today (phases + phase-scoped commits).

The Firestore security rules already grant a team member read access to every nested
doc under `projects/{slug}` (the recursive `match /{document=**}` from #1), so an
authenticated member can read goals/scenarios/tasks/scores/etc. with **no rules
change**. At current event volume readers fetch the small `scores`/`testRuns` sets and
pick the latest in memory — **no composite index** (matching the #1 spec).

## Components

### Data hooks (`web/src/dashboard/hooks.ts`)

Add, each a thin `onSnapshot` wrapper returning `Result<T>` like the existing
`usePhases`/`useCommits`:
- `useGoals(teamId, slug)` → `Goal[]` (ordered by `order`).
- `useScenarios(teamId, slug)` → `Scenario[]` (ordered by `order`).
- `useTasks(teamId, slug)` → `Task[]` (ordered by `order`).
- `useTaskCommits(teamId, slug, taskId)` → `Commit[]` (the forward path;
  `tasks/{taskId}/commits`, ordered by `createdAt desc`).
- `useScores(teamId, slug)` → `Score[]`; `useTestRuns(teamId, slug)` → `TestRun[]`
  — read the whole subcollection ordered by document id (`orderBy(documentId())`),
  which is the ULID replay order.
- `useRevisions(teamId, slug)` → `Revision[]` (ordered by document id).
- `useDocuments(teamId, slug)` → `DocumentRec[]` (ordered by document id — documents
  have no `order` field).

The existing `useCommits` (phase-scoped) stays for the legacy fallback.

### Derivation helper (`web/src/dashboard/scenarioState.ts`, pure, tested)

```
deriveScenarioState(scenario, scores, testRuns) →
  { state: "met" | "unmet", latestComposite: number | null, latestTest: TestRun | null }
```
- Filter `scores`/`testRuns` to this `scenario.id`; take the **latest by document id**
  (ULID order — lexical max), not by timestamp.
- `met` iff `latestScore.composite ≥ (scenario.threshold ?? 80)` AND
  `latestTestRun.failed === 0`. If there is no score, or no test run, → `unmet`
  (with whatever partial data exists surfaced for display).
- `summarize(scenarios, scoresByScenario, testRunsByScenario)` →
  `{ met: number, total: number }` for the banner.

This module imports nothing from Firestore — it's pure data-in/data-out, fully
unit-testable.

### UI components (`web/src/dashboard/components/`)

- **`ScenariosMetBanner`** — the "N/M scenarios met" headline (e.g. "3 / 5 scenarios
  met"), shown when the project has scenarios.
- **`VisionSection`** — goals in `order`, each rendering its scenarios (matched by
  `scenario.goalId`) as **`ScenarioCard`**s. A `ScenarioCard` shows: title +
  description; a **met/unmet badge** (reuse `StatusBadge` styling); the **latest
  composite as a bar** against the scenario threshold; the **latest test** passed/
  failed counts (+ issues if any); and an **expandable score history** — the per-
  scenario scores in id order rendered as a small CSS/SVG sparkline + list (no
  charting dependency).
- **`PlanSection`** — the phase→task tree. For each phase (ordered), its tasks
  (`task.phaseId === phase.id`, ordered) as **`TaskItem`**s showing task status,
  the scenarios it advances (`scenarioIds`), and its **task-scoped commits**
  (`useTaskCommits`). **Legacy fallback:** if the project has **no tasks at all**,
  render today's phases + phase-scoped commits exactly as the current `ProjectDetail`
  does — same "Phases" section header and markup (so existing projects are
  byte-for-byte unaffected; the plan must faithfully preserve that legacy path). The
  fallback trigger is strictly "no tasks at all": a project with scenarios but zero
  tasks still shows the Vision section and falls back to phase-commit rendering for the
  plan area.
- **`RevisionTimeline`** — revisions in id order; each entry shows the trigger
  (scenario + reason) and the `add/replace/reorder/drop` changes.
- **`DocumentsSection`** — documents listed by title/kind; `format:"url"` → external
  link; `format:"markdown"` → content shown lightly formatted (escaped text /
  whitespace-preserving; **no new markdown dependency** in this version).

### Composition (`web/src/dashboard/ProjectDetail.tsx`)

Order: `ProjectHeader` → `ScenariosMetBanner` → `VisionSection` → `PlanSection` →
`RevisionTimeline` → `DocumentsSection`. Each section is conditional on its data
(absent/empty → section hidden, or a small empty state where helpful). The existing
loading/error/empty handling (`Spinner`/`ErrorNote`/`EmptyState`) is reused per
section.

### Types (`web/src/dashboard/types.ts`)

Add `Goal`, `Scenario` (`goalId`, `title`, `description?`, `order?`, `threshold?`,
`rubric:{criteria:[{id,name,weight,max}]}`), `Task` (`phaseId`, `title`, `order`,
`status`, `scenarioIds?`), `Score` (`scenarioId`, `taskId`, `criteria`, `composite`,
`by?`, `note?`, `commitSha?`), `TestRun` (`scenarioId`, `taskId`, `passed`, `failed`,
`issues?`), `Revision` (`trigger:{scenarioId,reason}`, `changes:[]`), `DocumentRec`
(`kind`, `title`, `format`, `content`). Each carries its doc `id`.

## Data flow

`ProjectDetail` subscribes (via hooks) to the project doc + goals/scenarios/tasks/
scores/testRuns/revisions/documents. It groups scores/testRuns by `scenarioId`, runs
`deriveScenarioState` per scenario for the cards and `summarize` for the banner, and
groups tasks by `phaseId` for the tree. Everything is live via `onSnapshot`, so the
page updates in real time as a loop runs — same reactivity as today.

## Error handling

- Per-section loading/error/empty via the existing primitives; one failing
  subscription never blanks the whole page.
- Unknown/partial docs render defensively (missing fields → sensible blanks), since
  reporting is best-effort and a scenario may have a score but no test run yet (→
  shown as unmet with the partial data visible).

## Testing

- **`scenarioState.ts`** — thorough Vitest unit tests: met exactly at threshold;
  unmet when composite < threshold; unmet when latest testRun.failed > 0; latest
  selection is by id not timestamp (out-of-order insertion); no scores → unmet; no
  test runs → unmet; `summarize` counts; default threshold 80 when unset.
- **Components** — render tests for `ScenarioCard` (met vs unmet, composite bar,
  expandable history), `ScenariosMetBanner` (N/M), and `PlanSection` **legacy
  fallback** (no tasks → phases+commits), using the existing dashboard test harness
  (`web/src/dashboard/components/*.test.tsx`).
- **Hooks** are thin `onSnapshot` wrappers mirroring existing ones — not separately
  unit-tested, consistent with the current codebase.
- `web` build (`npm --prefix web run build`) stays clean; existing dashboard tests
  stay green.

## Out of scope (separate specs / deferred)

- **Editing the vision in the web UI** (a write path) — its own sub-project; this is
  read-only.
- **Notifications** on scenario flips / loop completion — its own sub-project.
- **Charting library / time-series** beyond the lightweight sparkline.
- **Markdown rendering dependency** for documents — lightly-formatted text for now.
- Composite Firestore indexes — not needed at current volume (a later tuning step).

## Success criteria

- Opening a loop-driven project (e.g. `testteam-7xjk/loopexp`) shows: an "N/M
  scenarios met" banner; the goals → scenarios with per-scenario met/unmet state,
  latest composite vs threshold, and latest test result; the phase→task tree with
  task-scoped commits; the revision timeline (empty when none); and the documents.
- `scenario.state` is derived correctly (latest-by-id score ≥ threshold AND latest
  testRun.failed == 0), verified by unit tests.
- A **legacy** phase-mode project (no scenarios/tasks) renders exactly as before
  (phases + phase-scoped commits) — no regression.
- The page updates live as a loop runs; `web` build is clean and dashboard tests pass.
- No API, CLI, or Firestore-rules change.
