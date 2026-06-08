# Autoloop iOS — SP2 Read Surfaces (project-detail tabs) — Design

**Date:** 2026-06-07
**Status:** Approved (design phase)

## Context

SP1 (the iOS walking skeleton) is built and merged-pending (PR #67): Google
sign-in + allowlist gate, the app tab shell, theming, the data-layer plumbing
(`QueryListener`, `RestClient`, Firestore decoding), the pure-logic ports
(`AccessGate`, `Status`, `LoopView`, `ScenarioState`), and a live Dashboard
project list with one write.

SP2 makes the **project-detail screen** fully live and read-rich — a native
mirror of the web's `web/src/dashboard/ProjectDetail.tsx` and its six tabs. It is
the second of five sub-projects in the native-mobile-apps initiative (see
`2026-06-06-native-mobile-apps-design.md`): SP1 skeleton → **SP2 read surfaces** →
SP3 write surfaces → SP4 FCM push → SP5 Android.

Like SP1, SP2 requires **no backend change** — it consumes the existing Firestore
data (gated by the shared `firestore.rules`) plus one existing REST endpoint
(`POST /v1/u/.../messages`).

### Decisions (from brainstorming)

- **Sub-tab navigation:** a **swipe pager** of the 6 tabs paired with a tappable,
  horizontally-scrollable strip indicator (both swipe and tap switch tabs; the
  strip avoids fighting horizontally-scrolling tab content).
- **Markdown:** add **swift-markdown-ui** (SPM) for full Markdown rendering of
  Vision documents / design content.
- **Messages:** include the **compose/send** box in SP2 (one write via the
  existing `postMessage` API), alongside the read-only thread and Session Log.
- Vision editing, project create/delete, bugs/teams/keys/admin writes remain SP3.

## Tabs (mirroring the web)

The live web tab bar (`components/Tabs.tsx`) has six tabs; Session Log is a
sub-segment of Messages, not a top-level tab:

1. **Dashboard** — rollup strip (loop status counts) + selected-loop snapshot
   (phase progress, current task, scenarios-met).
2. **Vision** — scenarios-met banner; goals → scenarios with rubric criteria and
   latest composite vs threshold (met/unmet); documents (Markdown or URL).
   Read-only in SP2.
3. **Loops** — selectable loop list (status + scenario chips) → loop detail
   (phases w/ commits, tasks w/ commits, test runs, revisions).
4. **Tests** — per-scenario expandable rows: latest-run pass/fail badge, run
   history with summaries + issues; includes scenarios that appear only in runs.
5. **Bugs** — bug list (severity, status, loop origin).
6. **Messages** — live thread + agent-active hint + compose box; a Session Log
   segment (sessions with user/assistant/tool entries).

## Architecture

A thin SwiftUI client over existing infrastructure, reusing SP1's data layer
(`QueryListener`, `RestClient`, Firestore decode helpers) and pure-logic ports.

### Store decomposition (state split by lifetime)

To avoid one ~16-listener god object:

- **`ProjectDetailStore`** (lives with the screen) owns project-level,
  always-needed data: `project`, `loops`, `goals`, `scenarios`, `documents`, and
  **loop-selection state** (`selectedId`, derived `loopArg`). It computes the loop
  list, default selection, effective status, and loop arg by feeding full models
  into the **already-ported SP1 pure functions** (`buildLoopList`,
  `defaultSelectedLoop`, `loopArgFor`, `effectiveProjectStatus`). Stores map full
  models → the small `…Rec` inputs those functions take, so **no domain code
  changes**.
- **Per-tab stores**, each subscribing on appear and tearing down on disappear,
  scoped to that tab's needs:
  - **Dashboard** → ProjectDetailStore + loop-scoped `phases/tasks/scores/testRuns`
  - **Vision** → ProjectDetailStore + `allScores/allTestRuns` (scenarios are
    project-level; met-state spans all loops)
  - **Loops** → loop-scoped `phases/tasks/testRuns/revisions` (+ per-phase/task
    commits, lazily)
  - **Tests** → `allTestRuns` (collectionGroup) + scenarios
  - **Bugs** → `allBugs` (collectionGroup)
  - **Messages** → `messages` + loop-scoped `sessionLog`, + compose via REST

Every subscription uses SP1's generic `QueryListener`.

### Data flow

Firestore snapshot → `QueryListener` → store maps `QueryDocumentSnapshot` →
full model (`init(id:data:)`) → `@Published`; views render. Loop selection in
`ProjectDetailStore` recomputes `loopArg`; loop-scoped per-tab stores re-subscribe
when `loopArg` changes. Compose calls `RestClient.postMessage`; the thread updates
live via the `messages` listener (no optimistic insert needed).

## Data layer

### New models (`Data/Models.swift`, SP1 `init(id:data:)` + typed-accessor pattern)

`Loop`, `Phase`, `Commit` (+`CommitTokens`), `Goal`, `Scenario`
(+`RubricCriterion`), `Task`, `Score`, `TestRun`, `Revision` (+`RevisionChange`),
`DocumentRec`, `Bug`, `Message`, `SessionDoc` (+`SessionEntry`). Timestamps via the
SP1 `Timestamp`→`Date` shim; loose/extra fields tolerated.

### New listener helpers (mirror `hooks.ts`, built on `QueryListener`)

- Project-level: `loops`, `goals`, `scenarios`, `documents`, `messages`
- Loop-scoped (path via SP1 `basePath`, which handles loop-vs-project-direct):
  `phases`, `tasks`, `scores`, `testRuns`, `revisions`, `sessionLog`
- All-scope merges `allTestRuns`, `allScores`, `allBugs` — **NOT** Firestore
  `collectionGroup` queries. Mirror the web (`hooks.ts`): fan out one
  `QueryListener` per scope (project-direct + each loop id from `loops`), keyed by
  scope; each snapshot stamps `loopId` onto its docs; merge all scopes and filter
  to currently-present scopes so a removed loop's data doesn't linger. This needs
  no new Firestore indexes/rules (it reuses the same per-collection reads).
- Lazy: `commits(phaseId)`, `taskCommits(taskId)`

Each exposes `data/loading/error` like the web's `Result<T>`.

### Rec bridge

The SP1 pure functions take minimal record structs. Stores build them from full
models: `LoopRec`/`ProjectRec`/`StatusLoop` for loop-view; `ScenarioRec`/
`ScoreRec`/`TestRunRec` for `deriveScenarioState`/`summarize`. The full models add
the display fields the views need (titles, descriptions, rubrics, timestamps).

## UI components (new, under `Features/ProjectDetail/`)

- `ProjectDetailView` — header + swipe pager + tappable strip + loop picker
- `DashboardTabView`, `VisionTabView`, `LoopsTabView`, `TestsTabView`,
  `BugsTabView`, `MessagesTabView` (+ a Session Log segment)
- Shared pieces ported as needed: rollup strip, loop snapshot, scenario/rubric
  rows, bug row, message bubble, test-run disclosure, a Markdown view wrapping
  swift-markdown-ui.

Each tab view is backed by its own store; files stay focused (one tab per file,
shared row components factored out).

## Error handling

- Each listener surfaces failures into its store's `error`; the screen renders an
  inline `ErrorNote` (SP1) without crashing.
- First-load spinners use the web's rule — show a spinner only while a source is
  `loading && data is empty` — so swiping tabs or switching loops (which keeps
  prior data until the new snapshot arrives) does not flash.
- Compose send errors surface inline under the composer; the thread itself stays
  live.
- A not-found project shows an empty state; listener permission errors surface as
  `ErrorNote` (the allowlist/rules already gate access).

## Testing

- **Unit tests (XCTest):** model decoders (Firestore dict → each new model,
  tolerating missing/loose fields and timestamps); the store→`Rec` mapping; and
  per-tab derived helpers not already covered — notably the Tests tab's
  latest-run / extra-scenario-from-runs logic. (`latestById`,
  `deriveScenarioState`, `buildLoopList`, `effectiveProjectStatus`, `phaseProgress`
  are already tested from SP1 and are reused unchanged.)
- **Build + manual acceptance:** open a project from the Dashboard; swipe through
  all six tabs; switch loops and see Dashboard/Loops update; confirm Vision
  documents render as Markdown; expand a test scenario and a session; send a
  message and watch it appear live in the thread.
- **Dependency:** `swift-markdown-ui` added via SPM in `project.yml`.

## Out of scope (later sub-projects)

Vision/goal/scenario/document editing, project create/delete, bug create/edit,
teams, keys, admin (SP3); FCM push (SP4); Android (SP5).
