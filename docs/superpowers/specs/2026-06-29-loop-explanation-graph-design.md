# Loop legibility — the explanation graph (SP2)

**Date:** 2026-06-29
**Status:** Design — approved, pending spec review
**Depends on:** SP1 (`docs/superpowers/specs/2026-06-28-loop-why-model-design.md`) — the `whyModel` (`web/src/dashboard/whyModel.ts`), `explainScenario`, the `Decision` type, and `useDecisions`. This branch stacks on `loop-why-model`.

## Problem

SP1 built the "why" model but wired it to nothing. The Map tab still renders the old structural graph: nodes are colored boxes (goal → scenario → task → bug) with no reasoning, edges are unlabeled, decisions/evidence are invisible, and met/unmet is the legacy 2-condition rule that ignores refutation. SP2 makes the graph the **explanation** — it renders the why-model — and consolidates the whole dashboard onto the verification-aware met/unmet state.

## Goals

- Render `whyModel` in the Map tab as a hybrid graph: a clean structural view by default, a toggle that reveals the full decision/evidence causal web.
- Put the "why" on the canvas: a one-line reason chip on scenario nodes, short "because" labels on edges, and a **why-panel** on selection (reasons + evidence + decisions).
- **Consolidate** the entire dashboard onto `explainScenario` (verification-aware); retire the divergent 2-condition `deriveScenarioState`.
- Extend the existing time-replay scrubber to **full reasoning replay** — decisions and evidence appear over time, with stable layout.

## Non-goals

- No backend or schema changes (SP1 shipped the data). No CLI changes.
- No new "timeline" tab or vision-tab inline explanations — that's SP3. SP2 reuses the model in the existing Map tab (and the consolidation incidentally improves Trends/banner/Scenario views).
- No graph library change — keep `@xyflow/react` + `dagre`.
- **The `product-map` "component" overlay is dropped.** Today `buildMap` renders optional component nodes from a `product-map` document (fetched in `ProjectDetail` and passed to `MapTab`). Retiring `buildMap` removes that overlay; SP2 does **not** re-implement component nodes in `whyGraph`. This is a deliberate, called-out casualty — the reasoning graph is the priority and the component overlay was a separate, lightly-used feature. It can be re-added later (as a `component` node kind in `whyModel`/`whyGraph`) if it proves valued; out of scope for v1.
- **No `WhyDecision.at` timestamp.** SP1 deferred it. SP2 does not add it: the why-panel orders decisions by their (ULID) id, which is already time-ordered, so no separate timestamp field is needed.

## Decisions locked during brainstorming

1. **Hybrid graph** — default clean structural view; a `Show reasoning` toggle reveals decision + evidence nodes.
2. **Consolidate everywhere** — the whole dashboard uses the 3-condition rule. Visible met counts in Trends and the scenarios-met banner will drop where a scenario is refuted. This is intended (the honest number).
3. **Full reasoning replay** — the scrubber replays decisions + evidence over time, not just structure/state.
4. **New projection module** — a pure `whyGraph.ts` projects `whyModel` → ReactFlow `{nodes, edges}`; `MapCanvas` stays a dumb renderer; `buildMap`/`mapView.ts` is retired for this tab.

## Architecture

Pipeline: data hooks → `buildWhyModel` (SP1) → **`whyGraph.ts`** (new, pure) → **`MapCanvas`** (renderer) → **`MapTab`** (state/orchestration).

### `web/src/dashboard/whyGraph.ts` (new, pure, unit-tested)

```ts
export type GraphNodeKind = "goal" | "scenario" | "task" | "bug" | "decision" | "evidence";

export interface GraphNode {
  id: string;            // the whyModel subject/decision/evidence id (already namespaced)
  kind: GraphNodeKind;
  label: string;
  state: SubjectState;   // met|unmet|neutral|active|bugged (decisions/evidence → neutral)
  whyChip?: string;      // one-line top failing reason, scenarios only (e.g. "score 72 < 80")
  loopId?: string;       // for the per-loop hue bar
  decisionKind?: DecisionKind;   // for decision-node styling
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "structure" | "affects" | "evidence";
  label?: string;        // "because" label on a structure edge that a decision affects
}

export function buildWhyGraph(model: WhyModel, opts: { showReasoning: boolean }): { nodes: GraphNode[]; edges: GraphEdge[] };
```

- **showReasoning=false (default):** emit only structural subjects (goal/scenario/task/bug). Each scenario node gets `whyChip` = the text of its top failing reason (or omitted when met). **Edge-label collapsing:** every `affects` edge in the model has the shape `{ from: <decisionId>, to: <subjectId> }` (the source is always a decision). For each such edge whose target subject (`scenario:`/`task:`) has an **incoming structure edge** (`goal→scenario` or `scenario→task`), attach that decision's `summary` as the `label` on that incoming structure edge — i.e. collapse the decision onto the parent→child edge instead of rendering a decision node. If a target has multiple affecting decisions, use the most recent (highest id) and the edge label may indicate the count (e.g. `+Backoff (+1 more)`). Decision and evidence nodes (and their `affects`/`evidence` edges) are **not** emitted in this mode.
- **showReasoning=true:** additionally emit `decision` and `evidence` nodes and their `affects`/`evidence` edges — the full web. Decision nodes carry `decisionKind` for styling; evidence nodes carry their kind/relation.
- Pure and total: no fetching, no React, no time logic. Dangling edges already impossible (the model dropped them in SP1); `whyGraph` only filters by mode.

### `MapCanvas` (modify `web/src/dashboard/components/MapCanvas.tsx`)

- Accept `{ nodes: GraphNode[]; edges: GraphEdge[] }` (the `whyGraph` output) instead of the old `MapGraph`.
- The custom node renderer learns the new kinds: `decision` (blue left-bar, `decisionKind` label) and `evidence` (small chip, supports/refutes tint); scenario nodes render the `whyChip` under the label.
- Edge labels: render `GraphEdge.label` (the "because" text) on the edge.
- **Node-state colors migrate from hardcoded hex to theme tokens** using the badge `color-mix()` pattern (met→`--st-completed`, unmet/neutral→muted, bugged→`--st-failed`, active→`--st-running`).
- **Stable replay layout:** lay out the **full (live) graph** with dagre once and cache positions by node id (a `useMemo` over the live node/edge id set). For a replay `cutoff`, render only the present subset, reusing cached positions; nodes fade in as their cutoff passes. Nothing relocates while scrubbing. (Re-layout only when the live id set changes or `showReasoning` toggles.)

### `MapTab` (modify `web/src/dashboard/tabs/MapTab.tsx`)

- Owns `showReasoning` (toggle), `cutoff` (scrubber; existing), and `selectedNodeId` (replaces `pickedNode`).
- **Inputs.** MapTab assembles a single `BuildWhyModelInput` (the SP1 shape: `{ loopId, goals, scenarios, tasks, bugs, scores, testRuns, verifications, revisions, visionChanges, decisions, ideas, currentTaskId }`), scoped to the selected loop. It already receives goals/scenarios/tasks/bugs/scores/testRuns/verifications. SP2 adds the rest: `decisions` via the new `useDecisions(teamId, slug, loopId)` hook called in MapTab, and `revisions` / `visionChanges` / `ideas` passed down from `ProjectDetail` (which already loads them via `useRevisions`/`useVisionChanges`/`useIdeas` for other tabs) as new `MapTab` props.
- Builds the model: at live → `buildWhyModel(input)`; during replay → `whyModelAtTime(input, cutoff)` (below). Then `buildWhyGraph(model, { showReasoning })`.
- On node select → the **why-panel** (replaces the plain detail card): reads the selected subject's `explanation.reasons`, the `evidence` rows linked to it, and the `decisions` whose `refs` include it — all from the model. Decision/evidence nodes show their own rationale/detail.

### Replay — `whyModelAtTime` (modify `web/src/dashboard/mapTimeline.ts`)

- **Signature:** `whyModelAtTime(input: BuildWhyModelInput, cutoff: number): WhyModel`. It returns a copy of `input` with every timestamped array (`scores, testRuns, verifications, decisions, revisions, visionChanges, tasks, bugs`) filtered to `createdAt <= cutoff`, then calls `buildWhyModel(filtered)`. Vision (`goals`/`scenarios`) is kept present across the whole timeline (as `mapAtTime` does today). `ideas` is passed through unfiltered (only used to synthesize a goal-pick).
- **This replaces the old `LoopSlice`/`mapAtTime` cross-loop replay.** The Map tab is scoped to the selected loop, so replay operates on that loop's flat `BuildWhyModelInput`, not the multi-loop slice structure. The slice machinery (`mapSlices`, `LoopSlice`) is retired with `buildMap`.
- **Cutoff bounds** are derived from the min/max `createdAt` across the input's timestamped records (as the current scrubber does).
- Requires `createdAt` on the web `Revision` type (Firestore stores it; the type just omits it). Add it; the `useRevisions` hook already spreads doc data. (`Decision` already has `createdAt` from SP1.)

### Consolidation — retire `deriveScenarioState`

`explainScenario` (SP1) becomes the single source of met/unmet. Introduce one helper used by every non-graph surface:

```ts
// web/src/dashboard/scenarioState.ts
export function scenarioStatus(scenario, scores, testRuns, verifications):
  { state: "met" | "unmet"; latestComposite: number | null; latestTest: TestRun | null; reasons: ExplanationReason[] }
```

It delegates `state`/`reasons` to `explainScenario` and keeps `latestComposite`/`latestTest` (via `latestById`) for display. `deriveScenarioState` and its 2-condition `met` logic are deleted; `summarize` is reimplemented on `scenarioStatus` and gains a `verifications` parameter.

**Every** call site is updated to pass `verifications` — the full list (the SP1 audit undercounted; this is the complete set):
- Graph/replay: `tabs/MapTab.tsx` (now via `whyGraph`/`whyModel`), `mapTimeline.ts` (now via `whyModelAtTime`).
- `deriveScenarioState`/`scenarioStatus` direct callers: `components/ScenarioTable.tsx`, `components/ScenarioCard.tsx`, `trendView.ts`.
- `summarize` callers (all currently 2-condition) — three files: **`tabs/VisionTab.tsx`** (which feeds the scenarios-met banner; `ScenariosMetBanner` itself just receives `{met,total}`), **`components/LoopList.tsx`**, **`components/LoopSnapshot.tsx`**.
- One-line cleanup: update the stale comment in `whyModel.ts` (~line 70) that says SP2 will add `WhyDecision.at` — SP2 intentionally does not (ULID ordering suffices).

**TrendView needs a data-loading change (don't miss this).** Making `buildTrend`/`trendView.ts` verification-aware requires `verifications: Verification[]` on `LoopRunData` (currently absent) and fetching verifications per loop in `useLoopTrend.ts` — its `FLAT_COLLECTIONS` list currently covers only `scores`/`testRuns`/`bugs`/`tasks`; add `verifications`.

Tests for `scenarioState`, `trendView`, and a `summarize` consumer update to assert verification-aware counts (a refuted-but-high scenario now counts unmet).

## Components / file map

| File | Change |
|---|---|
| `web/src/dashboard/whyGraph.ts` | **new** — pure `buildWhyGraph(model, {showReasoning})` projection |
| `web/src/dashboard/whyGraph.test.ts` | **new** — projection unit tests |
| `web/src/dashboard/scenarioState.ts` | replace `deriveScenarioState`/`summarize` with verification-aware `scenarioStatus`/`summarize` |
| `web/src/dashboard/mapTimeline.ts` | `mapAtTime` → `whyModelAtTime(inputs, cutoff)` over the why-model |
| `web/src/dashboard/trendView.ts` | use `scenarioStatus` (verification-aware); `LoopRunData` gains `verifications` |
| `web/src/dashboard/useLoopTrend.ts` | add `verifications` to `FLAT_COLLECTIONS` so per-loop trend data includes it |
| `web/src/dashboard/components/MapCanvas.tsx` | render `whyGraph` output; new node kinds; edge labels; theme-token colors; cached-layout replay |
| `web/src/dashboard/components/ScenarioCard.tsx`, `ScenarioTable.tsx` | read `scenarioStatus`; render the reason breakdown |
| `web/src/dashboard/tabs/VisionTab.tsx`, `components/LoopList.tsx`, `components/LoopSnapshot.tsx` | pass `verifications` to `summarize` |
| `web/src/dashboard/tabs/MapTab.tsx` | toggle + cutoff + selection; build model→graph; why-panel; new `revisions`/`visionChanges`/`ideas` props + `useDecisions` |
| `web/src/dashboard/ProjectDetail.tsx` | pass `revisions`/`visionChanges`/`ideas` (already loaded) into `MapTab`; drop the `product-map` document wiring (see non-goals) |
| `web/src/dashboard/types.ts` | add `createdAt` to `Revision` |
| `web/src/dashboard/mapView.ts`, `mapTimeline.ts` (old slice path) | retire `buildMap` + `LoopSlice`/`mapAtTime` once no caller remains |

## Error / empty states

- Empty project (no goals/scenarios): the graph renders nothing; show the existing empty-state message.
- A node selected then removed by a scrub-back: clear the selection if its id is absent at the current cutoff.
- Listener errors surface through the existing hook error state (SP1 web work); the why-panel shows nothing rather than crashing on missing refs (the model already drops dangling refs).

## Testing

- **`whyGraph.test.ts`** (the core): default mode emits only structural nodes + collapses a decision onto a "because" edge label; reasoning mode emits decision + evidence nodes and their edges; a met scenario has no `whyChip`, an unmet one has the top failing reason; state maps to the right token class input.
- **`scenarioState` tests:** `scenarioStatus` returns unmet for a refuted-but-high scenario; `summarize` counts it unmet.
- **`trendView` tests:** per-loop met count is verification-aware.
- **`mapTimeline` tests:** `whyModelAtTime` excludes records after the cutoff (a decision/score created later is absent) and keeps vision present.
- Component tests for `MapCanvas`/`MapTab` kept light (rendering smoke + toggle switches node count); the logic lives in the pure modules.

## Risks / open questions

- **Replay layout churn** — mitigated by the cache-positions-at-live approach; the one piece needing care during implementation. If dagre on the full reasoning graph is too wide, the live layout can be computed per `showReasoning` mode (two cached layouts) rather than one.
- **Numbers change on consolidation** — Trends/banner drop refuted scenarios from "met". Intended and called out, but it is a visible behavior change to flag in the PR.
- **Graph density with reasoning on** — large projects could get busy. v1 ships the toggle (off by default); per-kind filtering (hide evidence, show only decisions) is a fast-follow if needed, not v1.
- **`buildMap` retirement** — only the Map tab uses `buildMap`/`mapView`/`mapAtTime` (the trend strip uses `trendView`). Deleting them removes the `product-map` component overlay — an explicit non-goal casualty (above). Confirm no stray consumer before deleting; delete only what's unreferenced.
