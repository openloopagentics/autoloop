# Daloop — Tracking UI: tabs, loops, bugs, summaries, rollups design spec

**Date:** 2026-06-03
**Status:** approved (brainstorming, batch-level) — pending spec review + user review
**Sub-project:** SP2 of the tabs/loops/bugs batch — the **web tracking UI**. Consumes the
SP1 contract (PR #17: `bug` entity + `testRun.summary`) and the v2.1 loop contract. Read-only
(web reads Firestore via `onSnapshot`; no new writes — vision editing via #5 is unchanged).
SP3 (`/daloop` driver hygiene) is a separate spec.

## Goal

Restructure the project detail page into tabs — **Dashboard · Vision · Loops · Bugs** — and
make the existing run-data views **loop-aware**, so a project built by multiple loop runs is
legible:

- **Dashboard**: project rollups (total loops, # running, status) + the selected loop's
  snapshot (phases done/total e.g. `2/5`, `N/M scenarios met`, and the **in-progress task**
  shown prominently).
- **Vision**: the project-level vision (goals/scenarios + #5 editing) — unchanged content,
  now on its own tab.
- **Loops**: every loop listed (running ones marked) with per-loop progress; selecting one
  shows its phase→task tree, **test runs + their summaries**, scenario states, revisions.
- **Bugs**: the selected loop's bugs (open/fixed) in a dedicated view.

It also fixes the "lots of tasks stuck as running" confusion: **only the loop's derived
`currentTaskId` renders as the live/in-progress task**; every other task renders its stored
status. (The data-hygiene half — the driver marking tasks done — is SP3.)

## Architecture

**A read-side mirror of v2.1's base-path pattern, plus a tab shell.** Three moving parts:

1. **Loop-aware hooks.** The run-data hooks (`usePhases`, `useTasks`, `useScores`,
   `useTestRuns`, `useRevisions`, `useTaskCommits`, and legacy `useCommits`) gain an optional
   `loopId`. A tiny pure `basePath(teamId, slug, loopId?)` helper returns the Firestore path
   segments: `["teams", teamId, "projects", slug]` plus `["loops", loopId]` when a real loop is
   selected. The **vision hooks** (`useGoals`, `useScenarios`, `useDocuments`) and `useProject`
   stay project-level — untouched. New hooks: `useLoops` (the `loops` collection, ordered) and
   `useBugs(teamId, slug, loopId?)` (base-path-aware).

2. **Loop selection + `main` synthesis (pure, tested).** A `buildLoopList(loops,
   hasProjectDirectData)` helper produces the selectable list: the explicit loop docs, plus a
   synthesized `main` entry **iff** the project has project-direct phases/tasks (legacy data).
   A `defaultSelectedLoop(list, project.currentLoopId)` helper picks the default: the current
   loop → else the highest-`order`/most-recent loop → else `main`. The synthetic `main` maps to
   `loopId = undefined` in the hooks (project-direct reads); explicit loops map to their id.

3. **Tab shell.** `ProjectDetail` owns two pieces of state: `activeTab` and `selectedLoopId`
   (default from the helper). It renders a tab bar + a `LoopSelector` dropdown (shown on
   Dashboard/Loops/Bugs; hidden on Vision) and routes to the four tab components. Tab +
   selection live in component state (no URL/deep-link plumbing — YAGNI; can be added later).

All views remain `onSnapshot`-live; switching loops re-subscribes the loop-scoped hooks.

## Data model (web `types.ts` additions)

```ts
export interface Loop {
  id: string; goal?: string; name?: string; order?: number; status?: string;
  startedAt?: unknown; endedAt?: unknown;
  currentPhaseId?: string | null; currentTaskId?: string | null;
}
export interface Bug {
  id: string; title?: string; description?: string; scenarioId?: string; taskId?: string;
  severity?: "low" | "medium" | "high"; status?: "open" | "fixed";
  createdAt?: unknown; updatedAt?: unknown; fixedAt?: unknown;
}
```
Extend existing interfaces:
- `Project`: add `currentLoopId?: string | null;` and `currentTaskId?: string | null;`
- `TestRun`: add `summary?: string;`

A **selectable loop** (the synthesized view-model) is:
`{ id: string; isMain: boolean; goal?: string; name?: string; status?: string; order?: number;
   currentPhaseId?: string|null; currentTaskId?: string|null }`
where `main` carries `isMain:true`, `currentPhaseId`/`currentTaskId` from the **project** doc,
and `loopId` passed to hooks is `undefined`.

## Components & files

**New pure helpers (unit-tested):** `web/src/dashboard/loopView.ts`
- `basePath(teamId, slug, loopId?) → string[]` (path segments; `loopId` falsy ⇒ project-direct).
- `buildLoopList(loops: Loop[], hasProjectDirectData: boolean) → SelectableLoop[]`
  (explicit loops sorted by order/id; append `main` when `hasProjectDirectData`).
- `defaultSelectedLoop(list, currentLoopId) → string` (currentLoopId → most-recent → "main" →
  "" when empty).
- `phaseProgress(phases: Phase[]) → { done: number; total: number }` (done = terminal-status
  phases; reuse the contract's terminal set — `completed`/`cancelled`/etc. via a small
  `isTerminalStatus` shared with `status.ts`).
- `loopIsRunning(loop) → boolean` (status === "running").

**New hooks (in `hooks.ts`):** `useLoops`, `useBugs`; add optional `loopId` param to the seven
run-data hooks via `basePath`. (Each stays the same `Result<T>` shape.)

**New components (`web/src/dashboard/components/`):**
- `Tabs.tsx` — a small tab bar (Dashboard/Vision/Loops/Bugs) + active-tab state callback.
- `LoopSelector.tsx` — dropdown over the selectable loops (label = `name ?? goal ?? id`,
  status dot, "main" labeled "main (legacy)" when synthesized); calls back with the id.
- `RollupStrip.tsx` — project rollups: total loops, # running, project status badge.
- `LoopSnapshot.tsx` — the selected loop's card: goal/status, `phaseProgress` as `2/5`,
  `N/M scenarios met` (reuse `summarize` over the loop's scores/testRuns), and the in-progress
  task (the loop's `currentTaskId` task title + a "running" indicator), or "no active task".
- `LoopList.tsx` / `LoopRow.tsx` — all loops; each row: name/goal, `StatusBadge` (running
  marked), `phaseProgress`, `N/M met`; clicking selects it.
- `LoopDetail.tsx` — for the selected loop: the existing `PlanSection` (phase→task tree),
  `TestRunsSection`, `RevisionTimeline`, all scoped to that loop.
- `TestRunsSection.tsx` — lists the loop's test runs (latest first by id): passed/failed and,
  when present, the `summary` (rendered as text/markdown-ish, like `DocumentsSection`).
- `BugsList.tsx` / `BugItem.tsx` — bugs grouped open-first then fixed; each shows title,
  severity, status badge, and optional scenario/task refs + description.

**New tab containers (`web/src/dashboard/tabs/`):** `DashboardTab.tsx` (RollupStrip +
LoopSnapshot), `VisionTab.tsx` (ScenariosMetBanner + VisionSection/VisionEditableSection +
DocumentsSection — the current project-level content, scenario state derived from the **selected
loop's** scores/testRuns), `LoopsTab.tsx` (LoopList + LoopDetail), `BugsTab.tsx` (BugsList).

**Modified:**
- `ProjectDetail.tsx` — becomes the orchestrator: header, Tabs, LoopSelector, the loop-list +
  default-selection wiring, and per-tab rendering. The current monolithic body moves into the
  tab containers.
- `TaskItem.tsx` — replace the `task.status === "running"` live treatment with an `isCurrent`
  prop: `is-live` only when `isCurrent` (the loop's `currentTaskId`). Stored status badge stays.
- `PlanSection.tsx` — accept `currentTaskId` and pass `isCurrent={t.id === currentTaskId}` into
  the rendered task (via the existing `renderTask` render-prop — thread the flag through).

## Per-loop scenario state & rollups

- Scenario `met/unmet` and `N/M met` are derived from the **selected loop's** scores/testRuns
  (reuse `deriveScenarioState`/`summarize` unchanged — they already filter by `scenarioId`; we
  just feed them loop-scoped arrays). Scenarios themselves stay project-level.
- `phaseProgress` and the in-progress task are per the selected loop (the loop doc's phases &
  `currentTaskId`); for `main`, the project doc's `currentTaskId` and project-direct phases.
- Project rollups (total loops, # running) come from `useLoops`; project status from the
  project doc. (If there are no explicit loops, "total loops" reflects the single `main`.)

## Back-compat

- A legacy project with only project-direct data (e.g. `loopexp`): `useLoops` is empty,
  `hasProjectDirectData` is true ⇒ the list is a single synthesized `main`, selected by default,
  and every tab renders project-direct content — **identical to today's #4 view**, just inside
  the tab shell.
- A project with explicit loops AND leftover project-direct data shows `main` + the explicit
  loops (no migration; the driver may amend later).
- A fresh project with only loops shows just those loops (no `main`).

## Testing

- **Pure helpers** (`loopView.test.ts`): `basePath` (with/without loopId), `buildLoopList`
  (explicit-only, main-only, both, ordering), `defaultSelectedLoop` (current → recent → main →
  empty), `phaseProgress` (done/total incl. all-terminal and none-terminal), `loopIsRunning`.
- **Components** (following `detail.test.tsx`/`vision.test.tsx`/`shared.test.tsx`): LoopSelector
  renders the options incl. synthesized main; LoopList marks the running loop and shows
  `phaseProgress`/`N/M`; **TaskItem shows `is-live` ONLY for the current task** (and a non-current
  stored-"running" task does NOT get `is-live`); TestRunsSection renders a summary when present
  and omits it when absent; BugsList groups open-before-fixed and shows severity/status;
  RollupStrip counts loops/running; DashboardTab shows `2/5` + the in-progress task; tab
  switching renders the right container; a legacy (main-only) project renders unchanged content.
- `web` typecheck/build clean (`npm run build` in `web`); existing dashboard tests stay green
  (ProjectDetail refactor must not regress `detail.test.tsx`).

## Out of scope (separate sub-projects / deferred)

- **SP3** `/daloop` driver hygiene: marking tasks `completed`/`failed`, opening/fixing bugs,
  uploading test summaries, `loop start` at run start. (SP2 only *renders* what the contract
  stores; stale "running" tasks in existing data remain until the driver re-runs — but they no
  longer render as the live task.)
- **Cross-loop bug aggregation** ("All loops" bug view): the Bugs tab is per selected loop. A
  project-wide aggregate (fan-out across every loop's `bugs` subcollection) is deferred.
- **Per-loop notifications** (v2.3) and **deep-linking** tabs/loop via the URL.

## Success criteria

- ProjectDetail shows four working tabs; switching loops re-scopes Dashboard/Loops/Bugs while
  Vision stays project-level.
- Dashboard shows total loops, # running, status, and the selected loop's `phases done/total`,
  `N/M met`, and in-progress task.
- Loops tab lists all loops (running marked) with per-loop progress; selecting one shows its
  tree + test-run summaries + revisions, scoped to that loop.
- Bugs tab shows the selected loop's bugs (open/fixed).
- Only the loop's `currentTaskId` renders as the live task; other tasks render stored status.
- Legacy project-direct projects render unchanged as a single `main` loop; existing web tests
  stay green; build clean.
