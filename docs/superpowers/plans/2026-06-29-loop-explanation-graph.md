# Loop explanation graph (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the SP1 `whyModel` in the Map tab as a hybrid explanation graph (clean structural view + a "Show reasoning" toggle), with why-chips, "because" edge labels, a why-panel, full reasoning replay, and the whole dashboard consolidated onto the verification-aware met/unmet rule.

**Architecture:** A new pure `whyGraph.ts` projects `whyModel` → ReactFlow `{nodes, edges}`. `MapCanvas` becomes a dumb renderer of that. `MapTab` builds the model (live or time-sliced) and owns the toggle/scrubber/selection/why-panel. `deriveScenarioState` is replaced everywhere by a verification-aware `scenarioStatus`.

**Tech Stack:** Vite + React 18 + TypeScript, `@xyflow/react` + `dagre`, Vitest + React Testing Library. Pure modules tested directly; components kept thin.

**Spec:** `docs/superpowers/specs/2026-06-29-loop-explanation-graph-design.md`
**Branch:** `loop-explanation-graph` (already created off `loop-why-model`; the spec commit is on it). All work is in `web/`.

**Conventions:** Run web tests `cd web && npm test` (or `npm test -- <file>`); type-check/build `npm run build`. Use @superpowers:test-driven-development per task. Keep logic in pure modules (`whyGraph`, `scenarioStatus`, `whyModelAtTime`) and unit-test those; keep component tests light. Each task ends green (`npm run build` clean, tests pass) and is committed.

**Sequencing rationale:** Tasks 1–4 do the consolidation (additive first, so the build stays green; the old `deriveScenarioState` lives until Task 8 deletes it). Tasks 5–7 build and wire the graph. Task 8 deletes dead code and verifies.

---

## File Structure

| File | Change |
|---|---|
| `web/src/dashboard/types.ts` | add `createdAt?: unknown` to `Revision` |
| `web/src/dashboard/whyModel.ts` | one-line comment cleanup (the `at` deferral note) |
| `web/src/dashboard/scenarioState.ts` | **add** `scenarioStatus`; make `summarize` verification-aware; (delete `deriveScenarioState` in Task 8) |
| `web/src/dashboard/whyGraph.ts` | **new** — pure `buildWhyGraph(model, {showReasoning})` |
| `web/src/dashboard/whyGraph.test.ts` | **new** |
| `web/src/dashboard/whyModelAtTime.ts` | **new** — `whyModelAtTime(input, cutoff)` (replaces `mapTimeline.ts`'s `mapAtTime`) |
| `web/src/dashboard/whyModelAtTime.test.ts` | **new** |
| `web/src/dashboard/components/MapCanvas.tsx` | render `whyGraph` output; new node kinds; edge labels; theme-token colors; cached-layout replay |
| `web/src/dashboard/tabs/MapTab.tsx` | model→graph; toggle; cutoff; selection; why-panel; new inputs |
| `web/src/dashboard/components/WhyPanel.tsx` | **new** — selection detail (reasons + evidence + decisions) |
| `web/src/dashboard/tabs/VisionTab.tsx`, `components/LoopList.tsx`, `components/LoopSnapshot.tsx` | pass `verifications` to `summarize` |
| `web/src/dashboard/components/ScenarioTable.tsx`, `ScenarioCard.tsx` | use `scenarioStatus`; render reason breakdown |
| `web/src/dashboard/trendView.ts` | `LoopRunData.verifications`; `buildTrend` uses `scenarioStatus` |
| `web/src/dashboard/useLoopTrend.ts` | add `verifications` to `FLAT_COLLECTIONS` + assembly |
| `web/src/dashboard/ProjectDetail.tsx` | pass `revisions`/`visionChanges`/`ideas` to `MapTab`; drop `product-map` wiring |
| `web/src/dashboard/index.css` | `.mapnode` state colors → theme tokens; `decision`/`evidence`/why-chip/edge-label styles |
| `web/src/dashboard/mapView.ts`, `mapTimeline.ts` | **delete** in Task 8 (retire `buildMap`/`mapAtTime`/`LoopSlice`) |

---

## Task 1: Foundation — `Revision.createdAt` + comment cleanup

**Files:** Modify `web/src/dashboard/types.ts`, `web/src/dashboard/whyModel.ts`

- [ ] **Step 1: Add `createdAt` to `Revision`** in `types.ts` (the Firestore doc already has it; the `useRevisions` hook spreads doc data so no hook change needed):

```ts
export interface Revision { id: string; trigger?: { scenarioId?: string; reason?: string }; changes?: RevisionChange[]; createdAt?: unknown; }
```

- [ ] **Step 2: Fix the stale comment** in `whyModel.ts` (~line 68) — it claims SP2 will add `WhyDecision.at`. Replace that sentence with: `// at/loopId-required intentionally NOT added — the why-panel orders decisions by their (time-ordered ULID) id, so no separate timestamp is needed.`

- [ ] **Step 3: Verify build** — `cd web && npm run build` (clean).

- [ ] **Step 4: Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/whyModel.ts
git commit -m "feat(web): Revision.createdAt for replay; clarify WhyDecision comment"
```

---

## Task 2: `scenarioStatus` + verification-aware `summarize`

**Files:** Modify `web/src/dashboard/scenarioState.ts`; Test `web/src/dashboard/scenarioState.test.ts`. Then update the 3 `summarize` callers.

Current `summarize(scenarios, scores, testRuns)` is 2-condition. We make it verification-aware and add `scenarioStatus` (the display-friendly wrapper over SP1's `explainScenario`). `deriveScenarioState` stays for now (Task 8 deletes it).

- [ ] **Step 1: Write failing tests** (append to `scenarioState.test.ts`):

```ts
import { scenarioStatus, summarize } from "./scenarioState";
import type { Scenario, Score, TestRun, Verification } from "./types";

const scn: Scenario = { id: "s1", threshold: 80 };
const score = (id: string, c: number): Score => ({ id, scenarioId: "s1", composite: c });
const run = (id: string, f: number): TestRun => ({ id, scenarioId: "s1", failed: f });
const ver = (id: string, v: "confirmed" | "refuted"): Verification => ({ id, scenarioId: "s1", verdict: v });

describe("scenarioStatus", () => {
  it("met when score>=threshold, no fails, not refuted", () => {
    const r = scenarioStatus(scn, [score("A", 90)], [run("A", 0)], []);
    expect(r.state).toBe("met");
    expect(r.latestComposite).toBe(90);
    expect(r.reasons.every((x) => x.ok)).toBe(true);
  });
  it("unmet + refutation reason when refuted despite high score", () => {
    const r = scenarioStatus(scn, [score("A", 95)], [run("A", 0)], [ver("A", "refuted")]);
    expect(r.state).toBe("unmet");
    expect(r.reasons.find((x) => x.kind === "verification")?.ok).toBe(false);
  });
});
describe("summarize (verification-aware)", () => {
  it("counts a refuted-but-high scenario as unmet", () => {
    const r = summarize([scn], [score("A", 95)], [run("A", 0)], [ver("A", "refuted")]);
    expect(r).toEqual({ met: 0, total: 1 });
  });
});
```

- [ ] **Step 2: Run → fails** — `cd web && npm test -- scenarioState` (no `scenarioStatus`; `summarize` arity).

- [ ] **Step 3: Implement.** In `scenarioState.ts`, import `explainScenario` + `ExplanationReason` from `./whyModel` and `Verification` from `./types`. Add:

```ts
export interface ScenarioStatus {
  state: "met" | "unmet";
  latestComposite: number | null;
  latestTest: TestRun | null;
  reasons: ExplanationReason[];
}

/** Verification-aware scenario status: state/reasons from explainScenario (the canonical
 *  3-condition rule), plus latestComposite/latestTest for display. Replaces deriveScenarioState. */
export function scenarioStatus(scenario: Scenario, scores: Score[], testRuns: TestRun[], verifications: Verification[]): ScenarioStatus {
  const ex = explainScenario(scenario, scores, testRuns, verifications);
  const latestScore = latestById(scores.filter((s) => s.scenarioId === scenario.id));
  const latestTest = latestById(testRuns.filter((r) => r.scenarioId === scenario.id));
  return {
    state: ex.state === "met" ? "met" : "unmet",
    latestComposite: latestScore?.composite ?? null,
    latestTest,
    reasons: ex.reasons,
  };
}
```

Replace `summarize` with the verification-aware version:

```ts
export function summarize(scenarios: Scenario[], scores: Score[], testRuns: TestRun[], verifications: Verification[]): { met: number; total: number } {
  let met = 0;
  for (const s of scenarios) if (scenarioStatus(s, scores, testRuns, verifications).state === "met") met++;
  return { met, total: scenarios.length };
}
```

(Note: `explainScenario` returns `SubjectState`; for a plain scenario it's only ever `met`/`unmet`, so the `=== "met"` narrowing is safe.)

- [ ] **Step 4: Update the 3 `summarize` callers** to pass verifications (thread the data in where missing):
  - `tabs/VisionTab.tsx:16` → `summarize(scenarios, scores, testRuns, verifications)` (VisionTab already has `verifications` from the vision data; if not in scope, accept it as a prop from `ProjectDetail`, which has `verifications.data`).
  - `components/LoopList.tsx:18` → pass `verifications.data` (add the `useVerifications`/prop already available alongside `scores`/`testRuns` there).
  - `components/LoopSnapshot.tsx:12` → pass its `verifications` (thread as prop from its parent).
  Where a caller lacks verifications in scope, add a `verifications` prop and pass it from the parent that renders it. Keep each change minimal.

- [ ] **Step 5: Run → pass + build** — `cd web && npm test -- scenarioState && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/scenarioState.ts web/src/dashboard/scenarioState.test.ts web/src/dashboard/tabs/VisionTab.tsx web/src/dashboard/components/LoopList.tsx web/src/dashboard/components/LoopSnapshot.tsx
git commit -m "feat(web): verification-aware scenarioStatus + summarize; migrate summarize callers"
```

---

## Task 3: Scenario displays → `scenarioStatus` + reason breakdown

**Files:** Modify `components/ScenarioCard.tsx`, `components/ScenarioTable.tsx` (+ tests if present).

- [ ] **Step 1:** `ScenarioCard.tsx:7` currently `deriveScenarioState(scenario, scores, testRuns)` and already receives `verifications`. Switch to `scenarioStatus(scenario, scores, testRuns, verifications)`. Below the existing composite/test display, render the `reasons` (the 3 annotated conditions) — a small list showing each reason's `text`, failing ones first (they're already sorted). Reuse existing badge/`.scnbadge` styling.

- [ ] **Step 2:** `ScenarioTable.tsx:7` currently `deriveScenarioState(scenario, scores, testRuns)`. `ScenarioTable`/`ScenarioRow` **already accept a `verifications?: Verification[]` prop** — so the only change is switching the `deriveScenarioState(...)` call inside `ScenarioRow` to `scenarioStatus(scenario, scores, testRuns, verifications ?? [])`. The met/unmet badge now reflects refutation.

- [ ] **Step 3:** If `dashboard.test.tsx` or scenario component tests exist, update fixtures to include `verifications` and assert a refuted scenario shows "unmet". Add one such assertion.

- [ ] **Step 4: Run → pass + build.**

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/components/ScenarioCard.tsx web/src/dashboard/components/ScenarioTable.tsx web/src/dashboard/tabs/VisionTab.tsx
git commit -m "feat(web): scenario card/table use verification-aware status + show reasons"
```

---

## Task 4: TrendView verification-aware

**Files:** Modify `trendView.ts`, `useLoopTrend.ts` (+ `trendView.test.ts`).

- [ ] **Step 1: Write failing test** (append to `trendView.test.ts`): a loop whose only tagged scenario has composite ≥ threshold, 0 failed, **but a refuted verification** → `metCount === 0` for that point. The `LoopRunData` fixture now includes `verifications`.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement.**
  - `trendView.ts`: add `verifications: Verification[]` to `LoopRunData` (line ~13-20). In `buildTrend`, replace the line `if (deriveScenarioState(s, d.scores, d.testRuns).state === "met") metCount++;` with `if (scenarioStatus(s, d.scores, d.testRuns, d.verifications).state === "met") metCount++;` (import `scenarioStatus`).
  - `useLoopTrend.ts`: **three edits** (all required or it won't compile, since `FLAT_COLLECTIONS` is `as const` and types `coll`):
    1. Add `verifications?: Verification[]` to the `Slice` interface (line ~9) and import `Verification` from `./types`.
    2. Add `"verifications"` to `FLAT_COLLECTIONS` (line 12).
    3. Add `verifications: byScope[l.id]?.verifications ?? []` to the `LoopRunData` assembly (lines 74-81).

- [ ] **Step 4: Run → pass + build.**

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/trendView.ts web/src/dashboard/trendView.test.ts web/src/dashboard/useLoopTrend.ts
git commit -m "feat(web): trends count met scenarios verification-aware"
```

---

## Task 5: `whyGraph.ts` — the pure projection

**Files:** Create `web/src/dashboard/whyGraph.ts`, `web/src/dashboard/whyGraph.test.ts`.

Projects a `WhyModel` (SP1) into ReactFlow-ready nodes/edges, with the default/reasoning modes and the edge-label collapsing rule from the spec.

- [ ] **Step 1: Write failing tests** (`whyGraph.test.ts`). Build a small `WhyModel` literal (subjects: goal `goal:g1`, scenario `scenario:s1` with an `unmet` explanation whose first reason text is "score 72 < 80", task `task:t1`; a `plan-change` decision with `refs.taskIds:["t1"]`; one score evidence on `scenario:s1`; edges: structure `goal:g1→scenario:s1`, `scenario:s1→task:t1`, affects `<decId>→task:t1`, evidence `<evId>→scenario:s1`). Assert:

```ts
import { buildWhyGraph } from "./whyGraph";
// default mode
const d = buildWhyGraph(model, { showReasoning: false });
it("default: only structural node kinds", () => {
  expect(d.nodes.map((n) => n.kind).sort()).toEqual(["goal", "scenario", "task"]);
});
it("default: scenario carries a whyChip = top failing reason", () => {
  expect(d.nodes.find((n) => n.id === "scenario:s1")?.whyChip).toContain("72");
});
it("default: a decision collapses onto the target's incoming structure edge label", () => {
  const e = d.edges.find((x) => x.from === "scenario:s1" && x.to === "task:t1");
  expect(e?.label).toBeTruthy();           // the plan-change summary
});
it("default: no decision/evidence nodes or affects/evidence edges", () => {
  expect(d.nodes.some((n) => n.kind === "decision" || n.kind === "evidence")).toBe(false);
  expect(d.edges.some((e) => e.kind !== "structure")).toBe(false);
});
// reasoning mode
const r = buildWhyGraph(model, { showReasoning: true });
it("reasoning: emits decision + evidence nodes and their edges", () => {
  expect(r.nodes.some((n) => n.kind === "decision")).toBe(true);
  expect(r.nodes.some((n) => n.kind === "evidence")).toBe(true);
  expect(r.edges.some((e) => e.kind === "affects")).toBe(true);
  expect(r.edges.some((e) => e.kind === "evidence")).toBe(true);
});
it("met scenario has no whyChip", () => { /* model2 with a met scenario */ });
```

- [ ] **Step 2: Run → fails** (module missing).

- [ ] **Step 3: Implement `whyGraph.ts`:**

```ts
import type { WhyModel, WhyDecision, SubjectState, DecisionKind } from "./whyModel";

export type GraphNodeKind = "goal" | "scenario" | "task" | "bug" | "decision" | "evidence";
export interface GraphNode {
  id: string; kind: GraphNodeKind; label: string; state: SubjectState;
  whyChip?: string; loopId?: string; decisionKind?: DecisionKind;
}
export interface GraphEdge { id: string; from: string; to: string; kind: "structure" | "affects" | "evidence"; label?: string; }

export function buildWhyGraph(model: WhyModel, opts: { showReasoning: boolean }): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Structural subject nodes (always)
  for (const s of model.subjects) {
    const topFail = s.explanation?.reasons.find((r) => !r.ok);
    nodes.push({
      id: s.id, kind: s.kind as GraphNodeKind, label: s.label,
      state: s.explanation?.state ?? "neutral", loopId: s.loopId,
      whyChip: s.kind === "scenario" && s.explanation?.state === "unmet" ? topFail?.text : undefined,
    });
  }
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Structure edges (always)
  for (const e of model.edges) if (e.type === "structure") edges.push({ id: `${e.from}->${e.to}`, from: e.from, to: e.to, kind: "structure" });

  if (!opts.showReasoning) {
    // Collapse each decision onto the incoming structure edge of the subject it affects.
    // Pick the most recent decision per target (decisions are id-ordered → max id wins).
    const byTarget = new Map<string, WhyDecision>();
    for (const d of model.decisions) {
      for (const sid of d.refs.scenarioIds.map((x) => `scenario:${x}`).concat(d.refs.taskIds.map((x) => `task:${x}`))) {
        if (!nodeIds.has(sid)) continue;
        const prev = byTarget.get(sid);
        if (!prev || d.id > prev.id) byTarget.set(sid, d);
      }
    }
    for (const [target, d] of byTarget) {
      const edge = edges.find((e) => e.to === target && e.kind === "structure");
      if (edge) {
        const count = model.decisions.filter((x) =>
          x.refs.scenarioIds.includes(target.replace(/^scenario:/, "")) || x.refs.taskIds.includes(target.replace(/^task:/, ""))).length;
        edge.label = count > 1 ? `${d.summary} (+${count - 1} more)` : d.summary;
      }
    }
    return { nodes, edges };
  }

  // Reasoning mode: add decision + evidence nodes and their edges.
  for (const d of model.decisions) nodes.push({ id: d.id, kind: "decision", label: d.summary, state: "neutral", loopId: d.loopId, decisionKind: d.kind });
  for (const ev of model.evidence) nodes.push({ id: ev.id, kind: "evidence", label: String((ev.detail.composite ?? ev.detail.verdict ?? ev.kind)), state: "neutral" });
  const allIds = new Set(nodes.map((n) => n.id));
  for (const e of model.edges) {
    if (e.type === "affects" && allIds.has(e.from) && allIds.has(e.to)) edges.push({ id: `a:${e.from}->${e.to}`, from: e.from, to: e.to, kind: "affects" });
    if (e.type === "evidence" && allIds.has(e.from) && allIds.has(e.to)) edges.push({ id: `e:${e.from}->${e.to}`, from: e.from, to: e.to, kind: "evidence" });
  }
  return { nodes, edges };
}
```

- [ ] **Step 4: Run → pass + build.**

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/whyGraph.ts web/src/dashboard/whyGraph.test.ts
git commit -m "feat(web): whyGraph — pure whyModel→ReactFlow projection (hybrid modes)"
```

---

## Task 6: `whyModelAtTime` — full reasoning replay

**Files:** Create `web/src/dashboard/whyModelAtTime.ts`, `web/src/dashboard/whyModelAtTime.test.ts`.

- [ ] **Step 1: Write failing tests:** given a `BuildWhyModelInput` with a score at t=100 and a decision at t=300, `whyModelAtTime(input, 200)` yields a model whose `decisions` excludes the t=300 one (and a later score is excluded), while goals/scenarios remain present. Use the existing `tsMillis` helper semantics (number `createdAt` in tests).

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement.** Export `tsMillis` from this new module (it currently lives in `mapTimeline.ts`, which Task 8 deletes). **`loopView.ts` imports `tsMillis` from `./mapTimeline` (line 3) — update that import to `./whyModelAtTime` in this task** so nothing dangles when `mapTimeline.ts` is deleted.

```ts
import { buildWhyModel, type BuildWhyModelInput, type WhyModel } from "./whyModel";

export function tsMillis(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toMillis?: () => number }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
  return null;
}
const within = (cutoff: number) => (e: { createdAt?: unknown }) => { const t = tsMillis(e.createdAt); return t === null || t <= cutoff; };

/** The why-model as of time `cutoff`: timestamped records filtered to createdAt <= cutoff;
 *  vision (goals/scenarios) and ideas stay present. Then buildWhyModel over the slice. */
export function whyModelAtTime(input: BuildWhyModelInput, cutoff: number): WhyModel {
  const w = within(cutoff);
  return buildWhyModel({
    ...input,
    scores: input.scores.filter(w),
    testRuns: input.testRuns.filter(w),
    verifications: input.verifications.filter(w),
    decisions: input.decisions.filter(w),
    revisions: input.revisions.filter(w),
    visionChanges: input.visionChanges.filter(w),
    tasks: input.tasks.filter(w),
    bugs: input.bugs.filter(w),
  });
}
```

- [ ] **Step 4: Run → pass + build.**

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/whyModelAtTime.ts web/src/dashboard/whyModelAtTime.test.ts
git commit -m "feat(web): whyModelAtTime — time-sliced model for full reasoning replay"
```

---

## Task 7: Wire it up — MapCanvas, WhyPanel, MapTab, ProjectDetail

The integration task. After it, `deriveScenarioState`/`buildMap`/`mapAtTime` have no callers.

**Files:** Modify `components/MapCanvas.tsx`, `tabs/MapTab.tsx`, `ProjectDetail.tsx`, `index.css`; Create `components/WhyPanel.tsx`.

- [ ] **Step 1: MapCanvas** — accept `{ nodes: GraphNode[]; edges: GraphEdge[]; onNodeClick?; cutoffActive?: boolean }`. Changes vs current:
  - Node renderer: class `mapnode mapnode--${n.kind} map-${n.state}`; for `scenario` render `n.whyChip` in a `.mapnode-why` line under the label; `decision` nodes get `.mapnode--decision` (blue left-bar via `decisionKind`); `evidence` get `.mapnode--evidence`.
  - Edges: pass `label: e.label` into the ReactFlow edge object so "because" labels render; keep `id: e.id`.
  - **Cached-layout replay:** compute the dagre layout from the **live (full) graph** and memoize positions by id. Accept a `layoutNodes`/`layoutEdges` prop (the live graph) separate from the `nodes`/`edges` to render; lay out `layout*` once (memo keyed by their id-set + `showReasoning`), then render only the passed `nodes`, looking up cached positions (fall back to a fresh layout for any id not in cache). This keeps positions stable while scrubbing.

- [ ] **Step 2: WhyPanel** (`components/WhyPanel.tsx`) — props `{ model: WhyModel; nodeId: string; onClose }`. Look up the subject/decision/evidence by id; for a subject show `explanation.reasons` (annotated, failing first), the evidence rows whose `subjectId === nodeId`, and the decisions whose `refs` include the bare id; for a decision show its rationale + alternatives; for evidence show its `detail`. Pure read off the model. Replaces the old `MapPanelBody`/`ScenarioCard` panel.

- [ ] **Step 3: MapTab** — rewrite:
  - Props: add `revisions: Revision[]; visionChanges: VisionChange[]; ideas: Idea[]`. Remove `slices`/`productMap` (and the `LoopSlice` import).
  - Call `useDecisions(teamId, slug, selectedId)` — MapTab needs `teamId`/`slug`; pass them from `ProjectDetail` as props (it has `useParams`). 
  - Build `input: BuildWhyModelInput = { loopId: selectedId, goals, scenarios, tasks, bugs, scores, testRuns, verifications, revisions, visionChanges, decisions, ideas, currentTaskId }`.
  - `const liveModel = useMemo(() => buildWhyModel(input), [...])`. `const model = scrubT === null ? liveModel : whyModelAtTime(input, scrubT)`.
  - `const liveGraph = useMemo(() => buildWhyGraph(liveModel, { showReasoning }), [liveModel, showReasoning])` (for layout) and `const graph = buildWhyGraph(model, { showReasoning })` (to render).
  - State: `showReasoning` (default false), `scrubT` (existing), `selectedNodeId` (replaces `pickedNode`). Header: a `Show reasoning` toggle button. On scrub-back that removes the selected node, clear selection (`useEffect` checking presence in `graph.nodes`).
  - Render `<MapCanvas layoutNodes={liveGraph.nodes} layoutEdges={liveGraph.edges} nodes={graph.nodes} edges={graph.edges} onNodeClick={setSelectedNodeId} />`; keep `<MapScrubber>`; render `<WhyPanel model={model} nodeId={selectedNodeId} … />` when selected.
  - Keep the empty-state guard.

- [ ] **Step 4: ProjectDetail** — update the MapTab block (lines ~146-151): pass `teamId`, `slug`, `revisions={revisions.data}`, `visionChanges={visionChanges.data}`, `ideas={ideas.data}`; remove `slices`/`projectCreatedAt`/`productMap`. Also: **delete the now-unused `mapSlices` useMemo (lines ~84-91) and the `import type { LoopSlice } from "./mapTimeline"` (line 10)** so Task 8's deletion of `mapTimeline.ts` doesn't break the build. `useVisionChanges` is **not** currently called in ProjectDetail (only inside VisionTab) — add the `useVisionChanges(...)` hook call here and pass its `.data` down. Remove the `product-map` document lookup feeding MapTab if nothing else uses it.

- [ ] **Step 5: index.css** — migrate `.mapnode.map-*` colors to theme tokens via `color-mix` (met→`--st-completed`, bugged→`--st-failed`, active→`--st-running`, unmet/neutral→a muted token); add `.mapnode--decision` (blue left-bar), `.mapnode--evidence` (small/muted), `.mapnode-why` (small dim chip), and edge-label styling. Keep the pulse animation for `active`.

- [ ] **Step 6: Verify** — `cd web && npm test` (full suite green; update/trim any MapTab/MapCanvas snapshot or smoke test to the new props) and `npm run build` (clean). Add a light MapTab test: toggling `showReasoning` increases node count (decision/evidence appear).

- [ ] **Step 7: Commit**

```bash
git add web/src/dashboard/components/MapCanvas.tsx web/src/dashboard/components/WhyPanel.tsx web/src/dashboard/tabs/MapTab.tsx web/src/dashboard/ProjectDetail.tsx web/src/dashboard/index.css
git commit -m "feat(web): explanation graph — whyGraph-driven MapCanvas, why-panel, reasoning toggle, full replay"
```

---

## Task 8: Retire dead code + final verification

**Files:** Delete `web/src/dashboard/mapView.ts`, `web/src/dashboard/mapTimeline.ts`; remove `deriveScenarioState` from `scenarioState.ts`.

- [ ] **Step 1: Confirm no consumers** — `grep -rn "deriveScenarioState\|buildMap\|mapAtTime\|mapView\|mapTimeline\|LoopSlice\|product-map" web/src` returns only the definitions about to be deleted (and their tests). If anything else references them, stop and report.

- [ ] **Step 2: Delete** `mapView.ts` + `mapView.test.ts`, `mapTimeline.ts` + `mapTimeline.test.ts`, and the `deriveScenarioState` function + `ScenarioState` type (keep `latestById`, `DEFAULT_THRESHOLD`, `scenarioStatus`, `summarize`). Update `scenarioState.test.ts` to drop `deriveScenarioState` tests (covered by `scenarioStatus`/`explainScenario`).

- [ ] **Step 3: Verify** — `cd web && npm test` (full suite green) and `npm run build` (clean). Re-grep to confirm zero references.

- [ ] **Step 4: Commit**

```bash
git add -A web/src/dashboard
git commit -m "refactor(web): retire buildMap/mapView/mapTimeline + deriveScenarioState (consolidated on whyModel)"
```

---

## Notes for the implementer

- **Keep logic in the pure modules.** `whyGraph`, `whyModelAtTime`, `scenarioStatus` carry the testable logic; `MapCanvas`/`MapTab`/`WhyPanel` should be thin. If a component grows complex, push logic into a pure helper and test that.
- **Cached-layout replay is the one tricky bit** (Task 7 Step 1). The invariant: positions come from the live (full) graph laid out once; scrubbing only changes *which* nodes render, never their coordinates. Verify by scrubbing in the running app (`npm run dev`) — nodes must not jump.
- **Numbers change** (consolidation): trends/banner drop refuted-but-high scenarios from "met". Expected; call it out in the PR.
- **Product-map overlay is intentionally dropped** (spec non-goal). Don't try to preserve component nodes.
- **Verifications threading:** several consolidation callers didn't previously have `verifications` in scope — thread it from the nearest parent that does (`ProjectDetail` has `verifications.data`). Keep props minimal.
