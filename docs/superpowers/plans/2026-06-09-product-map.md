# Product map (graph screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Map tab** that draws the product as a living DAG — goals → scenarios → tasks → bugs colored by met-state, pulsing on the running task, updating live — plus a growth-replay scrubber (Phase 2) and an agent-reported architecture layer of component nodes (Phase 3). Three phases; **each phase ships alone** (Phase 1 has zero dependencies; Phase 2 depends on the preview-and-trends plan's all-loops fan-out hook; Phase 3 is the only phase touching backend/CLI/skill).

**Architecture:** Graph *derivation* is a pure module (`web/src/dashboard/mapView.ts`, fully unit-tested); *layout* is dagre (`rankdir=LR`, computed in a memo); *interaction* (pan/zoom/minimap/custom nodes/fit-view) is React Flow. Node state reuses `deriveScenarioState` from `scenarioState.ts`; live updates ride the existing Firestore listeners — no polling, no new collections, no rules change. Phase 2 adds a pure `mapTimeline.ts` ("graph as of time T" from `createdAt`s + ULID-ordered events) driven by a scrubber. Phase 3 adds one additive `contentFormat` enum value (`"json"`), a reserved `product-map` document validated **client-side**, a `DocumentsSection` json branch, a `doc add --format` CLI override, and one driver-skill step.

**Tech Stack:** React 18 + TypeScript + Vite + vitest/RTL (jsdom) in `web/`; **new web deps: `@xyflow/react` (React Flow, MIT) + `dagre`** (+ dev `@types/dagre`; Phase 3 also adds `zod` to web — see ambiguity note in Conventions). Firebase Cloud Functions v2 (TypeScript, zod, Vitest + Firestore emulator) in `functions/`; dependency-free Node CLI (`cli/autoloop.mjs`, 3 synced copies).

**Spec:** `docs/superpowers/specs/2026-06-09-product-map-design.md`

**Conventions (read before starting):**
- **Web tests:** full suite `cd web && npm test` (vitest run); single file `cd web && npm test -- mapView`. Build: `cd web && npm run build` (tsc -b + vite build; its `prebuild` copies `cli/autoloop.mjs` into `public/skill/`).
- **Functions tests:** single file with the emulator already running: `cd functions && npm run test:run -- <name>`. Full suite (spins up the emulator): `cd functions && npm test`. Rules: `cd functions && npm run test:rules`.
- **Web component tests are presentational** (see `components/*.test.tsx`): tabs/components receive data via props, tests render with literal props — no Firestore mocking. Keep `MapTab` fully presentational; mock only `MapCanvas` (React Flow does not run under jsdom — per the spec we test derivation + wiring, never React Flow internals).
- **CLI copies:** after any `cli/autoloop.mjs` edit run `bash scripts/sync-autoloop-cli.sh` (syncs `web/public/skill/autoloop.mjs` + `plugins/autoloop/bin/autoloop`, and the SKILL.md copies for the curl installer). Verify with `diff`.
- **Skill changes:** edit `plugins/autoloop/skills/autoloop/SKILL.md`, bump `plugins/autoloop/.claude-plugin/plugin.json` version (currently `0.10.1`), then run the sync script (it copies SKILL.md to `web/public/skill/autoloop/SKILL.md`).
- **Spec deviation, pre-resolved:** the spec demands a client-side **zod** `productMapSchema` but also says "the two new deps are the only additions" — `web/` has no zod today. This plan adds `zod` to web in Phase 3 (matching the functions stack) because schema-validation is the architectural intent; flagged to the user, do not re-litigate during implementation.
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## Phase 1 — derived live map (zero dependencies, web-only)

### Task 1: `buildMap` pure derivation (`mapView.ts`)

**Files:**
- Create: `web/src/dashboard/mapView.ts`
- Test: `web/src/dashboard/mapView.test.ts`

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/mapView.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildMap } from "./mapView";
import type { Bug, Goal, Scenario, Task } from "./types";

const goals: Goal[] = [{ id: "g1", title: "Ship auth" }];
const scenarios: Scenario[] = [
  { id: "login", goalId: "g1", title: "Login works" },
  { id: "logout", goalId: "g1", title: "Logout works" },
  { id: "orphan", goalId: "ghost", title: "Dangling goal ref" },
];
const states = {
  login: { state: "met" as const, latestComposite: 90, latestTest: null },
  logout: { state: "unmet" as const, latestComposite: null, latestTest: null },
  orphan: { state: "unmet" as const, latestComposite: null, latestTest: null },
};
const tasks: Task[] = [
  { id: "t1", title: "Build login", status: "completed", scenarioIds: ["login"] },
  { id: "t2", title: "Build logout", status: "running", scenarioIds: ["logout", "ghost-scn"] },
];
const bugs: Bug[] = [
  { id: "b1", title: "500 on login", status: "open", severity: "high", scenarioId: "login", taskId: "t1" },
  { id: "b2", title: "Slow logout", status: "open", severity: "low", scenarioId: "logout" }, // no taskId → scenario fallback
  { id: "b3", title: "Orphan bug", status: "open" }, // no refs → node, no edge
];

function graph(overrides: Partial<Parameters<typeof buildMap>[0]> = {}) {
  return buildMap({ goals, scenarios, scenarioStates: states, tasks, currentTaskId: "t2", openBugs: bugs, ...overrides });
}
const byId = (g: ReturnType<typeof buildMap>, id: string) => g.nodes.find((n) => n.id === id);

describe("buildMap nodes", () => {
  it("namespaces ids and types every entity", () => {
    const g = graph();
    expect(byId(g, "g:g1")?.type).toBe("goal");
    expect(byId(g, "s:login")?.type).toBe("scenario");
    expect(byId(g, "t:t1")?.type).toBe("task");
    expect(byId(g, "b:b1")?.type).toBe("bug");
  });
  it("goals are neutral; scenarios carry met/unmet from scenarioStates", () => {
    const g = graph();
    expect(byId(g, "g:g1")?.state).toBe("neutral");
    expect(byId(g, "s:logout")?.state).toBe("unmet");
  });
  it("an open HIGH bug overrides a met scenario to bugged", () => {
    expect(byId(graph(), "s:login")?.state).toBe("bugged"); // met, but b1 is open+high
  });
  it("a low-severity open bug does NOT override the scenario state", () => {
    expect(byId(graph(), "s:logout")?.state).toBe("unmet"); // b2 is low
  });
  it("the current task is active; others neutral; terminal tasks get done:true", () => {
    const g = graph();
    expect(byId(g, "t:t2")?.state).toBe("active");
    expect(byId(g, "t:t1")?.state).toBe("neutral");
    expect(byId(g, "t:t1")?.done).toBe(true);
    expect(byId(g, "t:t2")?.done).toBeUndefined();
  });
  it("open bugs are bugged nodes; labels fall back to ids", () => {
    const g = buildMap({ goals: [{ id: "g1" }], scenarios: [], scenarioStates: {}, tasks: [], currentTaskId: null, openBugs: [{ id: "b9", status: "open" }] });
    expect(byId(g, "b:b9")?.state).toBe("bugged");
    expect(byId(g, "b:b9")?.label).toBe("b9");
    expect(byId(g, "g:g1")?.label).toBe("g1");
  });
});

describe("buildMap edges", () => {
  const has = (g: ReturnType<typeof buildMap>, from: string, to: string) =>
    g.edges.some((e) => e.from === from && e.to === to);
  it("builds goal→scenario, scenario→task, task→bug", () => {
    const g = graph();
    expect(has(g, "g:g1", "s:login")).toBe(true);
    expect(has(g, "s:login", "t:t1")).toBe(true);
    expect(has(g, "t:t1", "b:b1")).toBe(true);
  });
  it("falls back to scenario→bug when the bug has no taskId", () => {
    expect(has(graph(), "s:logout", "b:b2")).toBe(true);
  });
  it("falls back to scenario→bug when the bug's task is not on the map", () => {
    const g = graph({ tasks: [] }); // b1 has taskId t1, but no task nodes
    expect(has(g, "s:login", "b:b1")).toBe(true);
  });
  it("drops dangling edges (missing goal, missing scenario, refless bug)", () => {
    const g = graph();
    expect(g.edges.some((e) => e.from === "g:ghost")).toBe(false);      // orphan scenario's goal
    expect(g.edges.some((e) => e.from === "s:ghost-scn")).toBe(false);  // t2's ghost scenario
    expect(g.edges.some((e) => e.to === "b:b3")).toBe(false);           // refless bug: node only
    expect(byId(g, "b:b3")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- mapView`
Expected: FAIL (`./mapView` does not exist).

- [ ] **Step 3: Implement**

`web/src/dashboard/mapView.ts`:

```ts
import type { Bug, Goal, Scenario, Task } from "./types";
import type { ScenarioState } from "./scenarioState";
import { isTerminalStatus } from "./status";

export type MapNodeType = "goal" | "scenario" | "task" | "bug" | "component";
export type MapNodeState = "met" | "unmet" | "active" | "bugged" | "neutral";

export interface MapNode {
  id: string;            // namespaced: g:/s:/t:/b:/c: — prevents collisions across collections
  type: MapNodeType;
  label: string;
  state: MapNodeState;
  done?: boolean;        // terminal task → rendered dimmed
  loopId?: string;       // which loop added it (Phase 2 hue band)
}
export interface MapEdge { from: string; to: string; }
export interface MapGraph { nodes: MapNode[]; edges: MapEdge[]; warning?: string; }

export interface BuildMapInput {
  goals: Goal[];
  scenarios: Scenario[];
  scenarioStates: Record<string, Pick<ScenarioState, "state">>; // by scenario id (deriveScenarioState)
  tasks: Task[];                 // the selected loop's tasks
  currentTaskId?: string | null;
  openBugs: Bug[];               // open bugs only (status !== "fixed")
  productMap?: string;           // Phase 3: raw product-map document content (JSON string)
}

/** Derive the product map DAG. Pure; defensive against agent-written data
 *  (edges referencing missing nodes are dropped, never thrown on). */
export function buildMap(input: BuildMapInput): MapGraph {
  const { goals, scenarios, scenarioStates, tasks, currentTaskId, openBugs } = input;
  const nodes: MapNode[] = [];

  for (const g of goals) nodes.push({ id: `g:${g.id}`, type: "goal", label: g.title ?? g.id, state: "neutral" });

  const buggedScenarios = new Set(
    openBugs.filter((b) => b.severity === "high" && b.scenarioId).map((b) => b.scenarioId as string));
  for (const s of scenarios) {
    const base = scenarioStates[s.id]?.state ?? "unmet";
    nodes.push({ id: `s:${s.id}`, type: "scenario", label: s.title ?? s.id, state: buggedScenarios.has(s.id) ? "bugged" : base });
  }

  for (const t of tasks) {
    const node: MapNode = { id: `t:${t.id}`, type: "task", label: t.title ?? t.id, state: t.id === currentTaskId ? "active" : "neutral" };
    if (t.status && isTerminalStatus(t.status)) node.done = true;
    nodes.push(node);
  }

  for (const b of openBugs) {
    const node: MapNode = { id: `b:${b.id}`, type: "bug", label: b.title ?? b.id, state: "bugged" };
    if (b.loopId) node.loopId = b.loopId;
    nodes.push(node);
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: MapEdge[] = [];
  const push = (from: string, to: string) => { if (ids.has(from) && ids.has(to)) edges.push({ from, to }); };

  for (const s of scenarios) if (s.goalId) push(`g:${s.goalId}`, `s:${s.id}`);
  for (const t of tasks) for (const sid of t.scenarioIds ?? []) push(`s:${sid}`, `t:${t.id}`);
  for (const b of openBugs) {
    if (b.taskId && ids.has(`t:${b.taskId}`)) push(`t:${b.taskId}`, `b:${b.id}`);
    else if (b.scenarioId) push(`s:${b.scenarioId}`, `b:${b.id}`);
  }

  return { nodes, edges };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test -- mapView`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/mapView.ts web/src/dashboard/mapView.test.ts
git commit -m "feat(web): buildMap — pure product-map graph derivation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Deps + `MapCanvas` (React Flow + dagre layout) + CSS

No unit tests here by design (the spec forbids snapshot-testing third-party layout/React Flow internals; wiring is tested in Task 3 with a mocked canvas; `tsc -b` in the build is the type gate).

**Files:**
- Modify: `web/package.json` (+ `@xyflow/react`, `dagre`; dev `@types/dagre`)
- Create: `web/src/dashboard/components/MapCanvas.tsx`
- Modify: `web/src/index.css` (map node styles + pulse animation)

- [ ] **Step 1: Install the two new dependencies**

Run: `cd web && npm install @xyflow/react dagre && npm install -D @types/dagre`
Expected: clean install; `package.json` lists all three.

- [ ] **Step 2: Implement `MapCanvas`**

`web/src/dashboard/components/MapCanvas.tsx`:

```tsx
import { useMemo } from "react";
import { ReactFlow, Background, MiniMap, Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import type { MapEdge, MapNode } from "../mapView";

const NODE_W = 168;
const NODE_H = 44;

/** dagre LR layout: goals left → bugs right. Pure function of the derived graph. */
function layout(nodes: MapNode[], edges: MapEdge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 64 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { id: n.id, type: "map", position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 }, data: { ...n } };
  });
}

function MapNodeView({ data }: NodeProps) {
  const n = data as unknown as MapNode;
  return (
    <div className={`mapnode mapnode--${n.type} map-${n.state}${n.done ? " mapnode--done" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="mapnode-label">{n.label}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { map: MapNodeView };

export function MapCanvas({ nodes, edges, onNodeClick }: {
  nodes: MapNode[]; edges: MapEdge[]; onNodeClick?: (id: string) => void;
}) {
  const rfNodes = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const rfEdges = useMemo<Edge[]>(
    () => edges.map((e) => ({ id: `${e.from}->${e.to}`, source: e.from, target: e.to })), [edges]);
  return (
    <div className="mapwrap">
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView
        nodesDraggable={false} nodesConnectable={false}
        onNodeClick={(_, n) => onNodeClick?.(n.id)}>
        <Background />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 3: Add the CSS**

Append to `web/src/index.css` (palette: match the existing `scn-met`/severity colors already in this file; the motion-off guards mirror the existing `.dot.is-live` pattern at ~line 236):

```css
/* ---- Product map (Map tab) ---- */
.mapwrap { height: 540px; border: 1px solid var(--border, #2a2a2a); border-radius: 8px; overflow: hidden; }
.mapnode { width: 168px; box-sizing: border-box; padding: 8px 10px; border-radius: 6px;
  border: 1px solid #5a5a5a; background: #1c1f24; font-size: 12px; line-height: 1.3; }
.mapnode-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mapnode--goal { font-weight: 600; }
.mapnode--component { border-style: dashed; }            /* Phase 3: distinct shape */
.mapnode.map-met { border-color: #2e9e44; background: rgba(46, 158, 68, .14); }
.mapnode.map-unmet, .mapnode.map-neutral { border-color: #6a6a6a; }
.mapnode.map-bugged { border-color: #d24545; background: rgba(210, 69, 69, .14); }
.mapnode.map-active { border-color: #e8a13a; background: rgba(232, 161, 58, .14);
  animation: mapnode-pulse 1.6s ease-in-out infinite; }
.mapnode--done { opacity: .45; }
@keyframes mapnode-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(232, 161, 58, .55); }
  50%      { box-shadow: 0 0 0 7px rgba(232, 161, 58, 0); }
}
[data-motion="off"] .mapnode.map-active { animation: none; }
@media (prefers-reduced-motion: reduce) { .mapnode.map-active { animation: none; } }
.map-panel { position: relative; margin-top: 12px; }
.map-panel-close { position: absolute; top: 8px; right: 10px; background: none; border: none; cursor: pointer; }
.map-warning { border-color: #e8a13a; font-size: 13px; }
```

- [ ] **Step 4: Build to verify types + bundling**

Run: `cd web && npm run build`
Expected: clean (no TS errors; vite bundles `@xyflow/react` + dagre).

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/src/dashboard/components/MapCanvas.tsx web/src/index.css
git commit -m "feat(web): MapCanvas — dagre LR layout + React Flow rendering with state-colored nodes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `MapTab` — loop selector, click-through side panel, empty state

**Files:**
- Create: `web/src/dashboard/tabs/MapTab.tsx`
- Test: `web/src/dashboard/components/map.test.tsx`

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/components/map.test.tsx` (the `vi.mock` path `./MapCanvas` resolves to the same module `MapTab` imports as `../components/MapCanvas`; React Flow never loads under jsdom):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MapEdge, MapNode } from "../mapView";

vi.mock("./MapCanvas", () => ({
  MapCanvas: ({ nodes, edges, onNodeClick }: { nodes: MapNode[]; edges: MapEdge[]; onNodeClick?: (id: string) => void }) => (
    <div data-testid="canvas" data-edges={edges.length}>
      {nodes.map((n) => (
        <button key={n.id} type="button" data-state={n.state} onClick={() => onNodeClick?.(n.id)}>{n.id}</button>
      ))}
    </div>
  ),
}));

import { MapTab } from "../tabs/MapTab";
import type { SelectableLoop } from "../loopView";

const loops: SelectableLoop[] = [
  { id: "l1", isMain: false, name: "Loop 1", status: "completed" },
  { id: "l2", isMain: false, name: "Loop 2", status: "running", currentTaskId: "t2" },
];

function renderTab(overrides: Partial<Parameters<typeof MapTab>[0]> = {}) {
  return render(<MapTab
    loops={loops} selectedId="l2" onSelect={() => {}}
    goals={[{ id: "g1", title: "Ship auth" }]}
    scenarios={[{ id: "login", goalId: "g1", title: "Login works", threshold: 80 }]}
    scores={[{ id: "01A", scenarioId: "login", composite: 90 }]}
    testRuns={[{ id: "01B", scenarioId: "login", passed: 3, failed: 0 }]}
    tasks={[{ id: "t2", title: "Build login", status: "running", scenarioIds: ["login"] }]}
    bugs={[{ id: "b1", title: "500 on login", status: "open", severity: "low", scenarioId: "login" },
           { id: "bf", title: "Old fixed", status: "fixed" }]}
    currentTaskId="t2"
    {...overrides} />);
}

describe("MapTab", () => {
  it("derives nodes with correct states and excludes fixed bugs", () => {
    renderTab();
    expect(screen.getByText("s:login")).toHaveAttribute("data-state", "met");
    expect(screen.getByText("t:t2")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("b:b1")).toHaveAttribute("data-state", "bugged");
    expect(screen.queryByText("b:bf")).toBeNull(); // fixed bug filtered out
  });
  it("keeps the LoopSelector visible", () => {
    renderTab();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
  it("clicking a scenario node opens a ScenarioCard side panel; close dismisses it", () => {
    renderTab();
    fireEvent.click(screen.getByText("s:login"));
    const panel = screen.getByRole("complementary", { name: /map detail/i });
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("Login works")).toBeInTheDocument(); // ScenarioCard title
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("clicking task / bug / goal nodes shows TaskItem / BugItem / goal card", () => {
    renderTab();
    fireEvent.click(screen.getByText("t:t2"));
    expect(screen.getByText("Build login")).toBeInTheDocument();   // TaskItem
    fireEvent.click(screen.getByText("b:b1"));
    expect(screen.getByText("500 on login")).toBeInTheDocument();  // BugItem
    fireEvent.click(screen.getByText("g:g1"));
    expect(screen.getByText("Ship auth")).toBeInTheDocument();     // goal card
  });
  it("shows the empty state when the vision has no goals", () => {
    renderTab({ goals: [] });
    expect(screen.getByText(/no goals yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- map.test`
Expected: FAIL (`../tabs/MapTab` does not exist).

- [ ] **Step 3: Implement `MapTab`**

`web/src/dashboard/tabs/MapTab.tsx`:

```tsx
import { useMemo, useState } from "react";
import { buildMap } from "../mapView";
import { deriveScenarioState, type ScenarioState } from "../scenarioState";
import { MapCanvas } from "../components/MapCanvas";
import { LoopSelector } from "../components/LoopSelector";
import { ScenarioCard } from "../components/ScenarioCard";
import { TaskItem } from "../components/TaskItem";
import { BugItem } from "../components/BugItem";
import { EmptyState } from "../components/EmptyState";
import type { SelectableLoop } from "../loopView";
import type { Bug, Goal, Scenario, Score, Task, TestRun } from "../types";

export interface MapTabProps {
  loops: SelectableLoop[]; selectedId: string; onSelect: (id: string) => void;
  goals: Goal[]; scenarios: Scenario[];
  scores: Score[]; testRuns: TestRun[];     // project-wide (all loops) — scenarios are project-level vision
  tasks: Task[]; bugs: Bug[];               // selected-loop scoped (same convention as the Loops tab)
  currentTaskId?: string | null;
}

interface PanelData { goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; tasks: Task[]; bugs: Bug[]; }

function MapPanelBody({ id, data }: { id: string; data: PanelData }) {
  const sep = id.indexOf(":");
  const ns = id.slice(0, sep);
  const key = id.slice(sep + 1);
  if (ns === "s") { const s = data.scenarios.find((x) => x.id === key); return s ? <ScenarioCard scenario={s} scores={data.scores} testRuns={data.testRuns} /> : null; }
  if (ns === "t") { const t = data.tasks.find((x) => x.id === key); return t ? <TaskItem task={t} commits={[]} /> : null; }
  if (ns === "b") { const b = data.bugs.find((x) => x.id === key); return b ? <BugItem bug={b} /> : null; }
  if (ns === "g") {
    const g = data.goals.find((x) => x.id === key);
    return g ? (<div className="map-goal"><h3>{g.title ?? g.id}</h3>{g.description && <p className="dim">{g.description}</p>}</div>) : null;
  }
  return null;
}

export function MapTab(props: MapTabProps) {
  const { loops, selectedId, onSelect, goals, scenarios, scores, testRuns, tasks, bugs, currentTaskId } = props;
  const [pickedNode, setPickedNode] = useState<string | null>(null);

  const openBugs = useMemo(() => bugs.filter((b) => (b.status ?? "open") === "open"), [bugs]);
  const scenarioStates = useMemo(() => {
    const m: Record<string, ScenarioState> = {};
    for (const s of scenarios) m[s.id] = deriveScenarioState(s, scores, testRuns);
    return m;
  }, [scenarios, scores, testRuns]);
  const graph = useMemo(
    () => buildMap({ goals, scenarios, scenarioStates, tasks, currentTaskId, openBugs }),
    [goals, scenarios, scenarioStates, tasks, currentTaskId, openBugs]);

  if (goals.length === 0) return <EmptyState message="No goals yet — the map appears once the vision has goals." />;

  return (
    <section className="maptab">
      <LoopSelector loops={loops} selectedId={selectedId} onChange={onSelect} />
      <MapCanvas nodes={graph.nodes} edges={graph.edges} onNodeClick={setPickedNode} />
      {pickedNode && (
        <aside className="map-panel card" aria-label="map detail">
          <button type="button" className="map-panel-close" aria-label="close" onClick={() => setPickedNode(null)}>×</button>
          <MapPanelBody id={pickedNode} data={{ goals, scenarios, scores, testRuns, tasks, bugs: openBugs }} />
        </aside>
      )}
    </section>
  );
}
```

> Note: the task panel reuses `TaskItem` with `commits={[]}` — fetching per-task commits would force a Firestore hook into the tab and break the presentational-test convention. Commits remain visible on the Loops tab.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test -- map.test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/tabs/MapTab.tsx web/src/dashboard/components/map.test.tsx
git commit -m "feat(web): MapTab — live product map with click-through side panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Tab registration + `ProjectDetail` wiring + Phase 1 gate

**Files:**
- Modify: `web/src/dashboard/components/Tabs.tsx` (TabKey + TABS entry: **Map between Bugs and Messages**)
- Modify: `web/src/dashboard/ProjectDetail.tsx` (loop-scoped bugs hook, tabLoading branch, render branch)
- Test: `web/src/dashboard/components/shell.test.tsx` (extend the Tabs test with order)

- [ ] **Step 1: Write the failing test**

In `web/src/dashboard/components/shell.test.tsx`, add to the `describe("Tabs", …)` block:

```tsx
  it("orders Map between Bugs and Messages", () => {
    render(<Tabs active="map" onChange={() => {}} />);
    const labels = screen.getAllByRole("tab").map((b) => b.textContent);
    expect(labels).toEqual(["Dashboard", "Vision", "Loops", "Tests", "Bugs", "Map", "Messages"]);
    expect(screen.getByRole("tab", { name: "Map" })).toHaveAttribute("aria-selected", "true");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- shell`
Expected: FAIL (`"map"` is not a `TabKey`; no Map tab rendered).

- [ ] **Step 3: Implement**

`web/src/dashboard/components/Tabs.tsx` — extend the union and the array (order matters):

```ts
export type TabKey = "dashboard" | "vision" | "loops" | "tests" | "bugs" | "map" | "messages";

const TABS: { key: TabKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "vision", label: "Vision" },
  { key: "loops", label: "Loops" },
  { key: "tests", label: "Tests" },
  { key: "bugs", label: "Bugs" },
  { key: "map", label: "Map" },
  { key: "messages", label: "Messages" },
];
```

`web/src/dashboard/ProjectDetail.tsx`:
1. Add `useBugs` to the hooks import line and `import { MapTab } from "./tabs/MapTab";` next to the other tab imports.
2. After the `const bugs = useAllBugs(teamId, slug);` line add:
   ```ts
   const loopBugs = useBugs(teamId, slug, loopArg); // Map tab: bugs scoped to the selected loop
   ```
3. Extend `dataError` with `|| loopBugs.error`.
4. Add the `tabLoading` branch (before the final vision fallback):
   ```ts
   : tab === "map" ? (goals.loading && goals.data.length === 0)
   ```
5. Add the render branch between the bugs and messages branches:
   ```tsx
   {tab === "map" && (
     <MapTab loops={loopList} selectedId={selectedId} onSelect={setPicked}
       goals={goals.data} scenarios={scenarios.data} scores={allScores.data} testRuns={allTestRuns.data}
       tasks={tasks.data} bugs={loopBugs.data} currentTaskId={selected?.currentTaskId} />
   )}
   ```

(The `/dashboard/:teamId/:slug/:tab` route is generic — no route change needed.)

- [ ] **Step 4: Phase 1 gate — full web build + suite**

Run: `cd web && npm run build && npm test`
Expected: build clean; ALL web suites green (Phase 1 is shippable here).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/components/Tabs.tsx web/src/dashboard/components/shell.test.tsx web/src/dashboard/ProjectDetail.tsx
git commit -m "feat(web): register the Map tab (between Bugs and Messages)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 2 — growth replay

> **DEPENDENCY:** Phase 2's data layer reuses the bounded all-loops fan-out hook from the
> preview-and-trends plan (`docs/superpowers/plans/2026-06-09-preview-and-trends.md`, Tasks 4–5;
> build order lands it before this plan). Concretely: `useLoopTrend(teamId, slug, includeMain)`
> in `web/src/dashboard/useLoopTrend.ts` returns `{ data: LoopRunData[]; loading; error }`,
> where `LoopRunData` (exported from `web/src/dashboard/trendView.ts`) is
> `{ loop: Loop; scores: Score[]; testRuns: TestRun[]; bugs: Bug[]; taskCommits: Commit[]; tasks: Task[] }`
> — live listeners for the 4 flat collections over `trendWindow` (the most recent
> `TREND_LOOPS_MAX = 20` loops, implicit `main` FIRST when `includeMain`, via the `byScope`
> accumulator pattern), plus one-shot `getDocs` task-commit reads keyed on a per-loop
> tasks-snapshot key (the map ignores `taskCommits`). The `main` slice arrives as
> `loop.id === MAIN_ID` (`"main"` from `loopView.ts`). The replay therefore inherits the same
> 20-loop window: loops older than the window contribute no tasks/bugs/events to the scrubbed
> graph (goals/scenarios are project-level and unaffected).

### Task 5: `createdAt` type extensions + pure `mapTimeline.ts`

**Files:**
- Modify: `web/src/dashboard/types.ts` (one-line `createdAt?: unknown` extensions; the services already stamp `createdAt` and the hooks spread the raw doc)
- Create: `web/src/dashboard/mapTimeline.ts`
- Test: `web/src/dashboard/mapTimeline.test.ts`

- [ ] **Step 1: Extend the types**

In `web/src/dashboard/types.ts` add `createdAt?: unknown;` to **`Goal`**, **`Scenario`**, **`Task`**, **`Project`**, **`Score`**, and **`TestRun`** (Bug already has it), and add `loopId?: string; // client-attached (timeline merge)` to **`Task`**. (The spec names Goal/Scenario/Task; Project is needed for the scrubber's range start and Score/TestRun for the event cutoff — same one-line pattern, all server-stamped today.)

- [ ] **Step 2: Write the failing tests**

`web/src/dashboard/mapTimeline.test.ts` (numeric `createdAt`s — `tsMillis` accepts numbers and Firestore `Timestamp`s alike):

```ts
import { describe, it, expect } from "vitest";
import { mapAtTime, tsMillis } from "./mapTimeline";
import type { LoopSlice } from "./mapTimeline";

const goals = [{ id: "g1", title: "G", createdAt: 1000 }];
const scenarios = [{ id: "login", goalId: "g1", title: "Login", threshold: 80, createdAt: 1000 }];
const slices: LoopSlice[] = [
  { loopId: "l1",
    tasks: [{ id: "t1", title: "T1", status: "completed", scenarioIds: ["login"], createdAt: 2000 }],
    bugs: [{ id: "b1", title: "B1", status: "open", scenarioId: "login", createdAt: 2500 }],
    scores: [{ id: "01A", scenarioId: "login", composite: 90, createdAt: 3000 },
             { id: "01C", scenarioId: "login", composite: 50, createdAt: 5000 }],
    testRuns: [{ id: "01B", scenarioId: "login", passed: 1, failed: 0, createdAt: 3000 }] },
  { loopId: "l2",
    tasks: [{ id: "t1", title: "T1 again", status: "running", scenarioIds: ["login"], createdAt: 6000 }],
    bugs: [], scores: [], testRuns: [] },
];
const at = (cutoff: number) => mapAtTime({ goals, scenarios, slices, cutoff });
const ids = (g: ReturnType<typeof at>) => g.nodes.map((n) => n.id);

describe("tsMillis", () => {
  it("normalizes numbers, Timestamp-likes, and absent", () => {
    expect(tsMillis(42)).toBe(42);
    expect(tsMillis({ toMillis: () => 99 })).toBe(99);
    expect(tsMillis(undefined)).toBeNull();
  });
});

describe("mapAtTime entity cutoff", () => {
  it("filters entities to createdAt <= T", () => {
    const g = at(1500);
    expect(ids(g)).toContain("g:g1");
    expect(ids(g)).toContain("s:login");
    expect(ids(g).some((i) => i.startsWith("t:"))).toBe(false);
    expect(ids(g).some((i) => i.startsWith("b:"))).toBe(false);
  });
  it("includes entities with missing createdAt (legacy) at any T", () => {
    const g = mapAtTime({ goals: [{ id: "g0" }], scenarios: [], slices: [], cutoff: 1 });
    expect(ids(g)).toContain("g:g0");
  });
  it("merges all loops' tasks, loop-scoping colliding ids and tagging loopId", () => {
    const g = at(7000);
    const taskNodes = g.nodes.filter((n) => n.type === "task");
    expect(taskNodes).toHaveLength(2);                       // t1 from l1 AND t1 from l2
    expect(new Set(taskNodes.map((n) => n.id)).size).toBe(2); // no collision
    expect(taskNodes.map((n) => n.loopId).sort()).toEqual(["l1", "l2"]);
  });
});

describe("mapAtTime met-at-T (latest-by-ULID within cutoff)", () => {
  it("scenario unmet before any event, met after passing score+run, unmet after a later low score", () => {
    expect(at(2000).nodes.find((n) => n.id === "s:login")?.state).toBe("unmet");
    // at 3500: latest score within cutoff = 01A (90) + run failed 0... but b1 (open, no severity) is low → no bugged override
    expect(at(3500).nodes.find((n) => n.id === "s:login")?.state).toBe("met");
    expect(at(5500).nodes.find((n) => n.id === "s:login")?.state).toBe("unmet"); // 01C (50) is now latest
  });
});

describe("mapAtTime monotonic growth", () => {
  it("the node set only grows as T advances (goals/scenarios/tasks; no fixed bugs in fixture)", () => {
    const ts = [500, 1500, 2200, 2700, 4000, 6500];
    let prev = new Set<string>();
    for (const t of ts) {
      const cur = new Set(ids(at(t)));
      for (const id of prev) expect(cur.has(id)).toBe(true);
      prev = cur;
    }
    expect(prev.size).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npm test -- mapTimeline`
Expected: FAIL (`./mapTimeline` does not exist).

- [ ] **Step 4: Implement**

`web/src/dashboard/mapTimeline.ts`:

```ts
import type { Bug, Goal, Scenario, Score, Task, TestRun } from "./types";
import { deriveScenarioState, type ScenarioState } from "./scenarioState";
import { buildMap, type MapGraph } from "./mapView";

/** Normalize a Firestore Timestamp / number / absent into millis (null when unknown). */
export function tsMillis(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

/** One loop's run data (loopId undefined = project-direct "main"). */
export interface LoopSlice {
  loopId?: string;
  tasks: Task[];
  bugs: Bug[];
  scores: Score[];
  testRuns: TestRun[];
}

/** Missing createdAt (legacy data) ⇒ treated as always-present, keeping growth monotonic. */
const within = (cutoff: number) => (e: { createdAt?: unknown }) => {
  const t = tsMillis(e.createdAt);
  return t === null || t <= cutoff;
};

/** Cross-loop ids can collide (each loop names its own tasks/bugs); scope merged ids by loop. */
const scoped = (loopId: string | undefined, id: string) => (loopId ? `${loopId}.${id}` : id);

/** The graph as of time T: entities filtered to createdAt <= T; scenario met-state evaluated
 *  over only the events with createdAt <= T (deriveScenarioState already picks the
 *  latest-by-ULID, so restricting its input arrays restricts it to "latest within cutoff").
 *  Bugs render while open at T (created <= T and not yet fixed at T) — the one sanctioned
 *  exception to monotonic growth, mirroring the live view's open-bugs-only rule. */
export function mapAtTime(input: { goals: Goal[]; scenarios: Scenario[]; slices: LoopSlice[]; cutoff: number }): MapGraph {
  const { goals, scenarios, slices, cutoff } = input;
  const inWindow = within(cutoff);

  const goalsT = goals.filter(inWindow);
  const scenariosT = scenarios.filter(inWindow);
  const scoresT = slices.flatMap((sl) => sl.scores).filter(inWindow);
  const runsT = slices.flatMap((sl) => sl.testRuns).filter(inWindow);

  const scenarioStates: Record<string, ScenarioState> = {};
  for (const s of scenariosT) scenarioStates[s.id] = deriveScenarioState(s, scoresT, runsT);

  const tasksT: Task[] = slices.flatMap((sl) =>
    sl.tasks.filter(inWindow).map((t) => ({ ...t, id: scoped(sl.loopId, t.id), loopId: sl.loopId })));
  const openAtT = (b: Bug) => {
    const fixed = tsMillis(b.fixedAt);
    return inWindow(b) && (b.status !== "fixed" || fixed === null || fixed > cutoff);
  };
  const bugsT: Bug[] = slices.flatMap((sl) =>
    sl.bugs.filter(openAtT).map((b) => ({
      ...b,
      id: scoped(sl.loopId, b.id),
      taskId: b.taskId ? scoped(sl.loopId, b.taskId) : b.taskId, // bug→task edges stay within the loop
      loopId: sl.loopId,
    })));

  return buildMap({ goals: goalsT, scenarios: scenariosT, scenarioStates, tasks: tasksT, currentTaskId: null, openBugs: bugsT });
}
```

Also add the **one-line loopId copy** in `buildMap` (`web/src/dashboard/mapView.ts`, task loop — Task type now has `loopId`):

```ts
    if (t.loopId) node.loopId = t.loopId;
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npm test -- mapTimeline && npm test -- mapView`
Expected: both PASS (mapView unaffected by the loopId copy).

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/mapTimeline.ts web/src/dashboard/mapTimeline.test.ts web/src/dashboard/mapView.ts
git commit -m "feat(web): mapTimeline — the product map as of time T (monotonic growth replay)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Per-loop hue band (`hueForLoop` + MapCanvas)

**Files:**
- Modify: `web/src/dashboard/mapView.ts` (export `hueForLoop`)
- Modify: `web/src/dashboard/components/MapCanvas.tsx` (hue band on nodes with a `loopId`)
- Test: `web/src/dashboard/mapView.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `web/src/dashboard/mapView.test.ts` (extend the import with `hueForLoop`):

```ts
describe("hueForLoop", () => {
  it("is deterministic and in [0, 360)", () => {
    expect(hueForLoop("loop-2026-06-09")).toBe(hueForLoop("loop-2026-06-09"));
    expect(hueForLoop("l1")).toBeGreaterThanOrEqual(0);
    expect(hueForLoop("l1")).toBeLessThan(360);
  });
  it("differs for different loop ids", () => {
    expect(hueForLoop("l1")).not.toBe(hueForLoop("l2"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- mapView`
Expected: FAIL (`hueForLoop` not exported).

- [ ] **Step 3: Implement**

Add to `web/src/dashboard/mapView.ts`:

```ts
/** Deterministic hue per loop so each loop's additions read as a growth ring (Phase 2). */
export function hueForLoop(loopId: string): number {
  let h = 0;
  for (let i = 0; i < loopId.length; i++) h = (h * 31 + loopId.charCodeAt(i)) % 360;
  return h;
}
```

In `MapCanvas.tsx`, import `hueForLoop` and give `MapNodeView`'s outer div the band:

```tsx
    <div className={`mapnode mapnode--${n.type} map-${n.state}${n.done ? " mapnode--done" : ""}`}
      style={n.loopId ? { borderLeft: `4px solid hsl(${hueForLoop(n.loopId)} 70% 55%)` } : undefined}>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test -- mapView && npm run build`
Expected: tests PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/mapView.ts web/src/dashboard/mapView.test.ts web/src/dashboard/components/MapCanvas.tsx
git commit -m "feat(web): per-loop hue band on map nodes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Scrubber UI + replay wiring + Phase 2 gate

> **Read first:** preview-and-trends plan Tasks 4–5 and the landed
> `web/src/dashboard/useLoopTrend.ts` + `web/src/dashboard/trendView.ts`. By this point the
> trends plan's Task 7 has ALSO already wired `ProjectDetail` with
> `const trend = useLoopTrend(teamId, slug, hasProjectDirectData);` and added `trend.error`
> to the `dataError` chain — Step 4 below **reuses that exact call** (do NOT invoke the hook
> a second time; that would double the ≤20×4 listener fan-out).

**Files:**
- Create: `web/src/dashboard/components/MapScrubber.tsx`
- Modify: `web/src/dashboard/tabs/MapTab.tsx` (replay mode)
- Modify: `web/src/dashboard/ProjectDetail.tsx` (slices + project `createdAt` props)
- Modify: `web/src/index.css` (scrubber styles)
- Test: `web/src/dashboard/components/map.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `web/src/dashboard/components/map.test.tsx`:

```tsx
import { MapScrubber } from "./MapScrubber";

describe("MapScrubber", () => {
  it("emits a numeric time mid-range and null (live) at max", () => {
    const onChange = vi.fn();
    render(<MapScrubber min={1000} max={5000} value={null} playing={false} onChange={onChange} onPlayPause={() => {}} />);
    const slider = screen.getByRole("slider", { name: /map time/i });
    fireEvent.change(slider, { target: { value: "3000" } });
    expect(onChange).toHaveBeenCalledWith(3000);
    fireEvent.change(slider, { target: { value: "5000" } });
    expect(onChange).toHaveBeenCalledWith(null); // released at max ⇒ live
  });
  it("shows live label when value is null and toggles play/pause", () => {
    const onPlayPause = vi.fn();
    render(<MapScrubber min={0} max={100} value={null} playing={false} onChange={() => {}} onPlayPause={onPlayPause} />);
    expect(screen.getByText(/live/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(onPlayPause).toHaveBeenCalled();
  });
});

describe("MapTab replay mode", () => {
  const slices = [{
    loopId: "l2",
    tasks: [{ id: "t2", title: "Build login", status: "running", scenarioIds: ["login"], createdAt: 4000 }],
    bugs: [], scores: [], testRuns: [],
  }];
  it("renders mapAtTime(T) while scrubbed: a task created after T disappears", () => {
    renderTab({ slices, projectCreatedAt: 1000 });
    expect(screen.getByText("t:t2")).toBeInTheDocument(); // live mode first
    fireEvent.change(screen.getByRole("slider", { name: /map time/i }), { target: { value: "2000" } });
    expect(screen.queryByText(/t2/)).toBeNull();          // not yet created at T=2000
    expect(screen.getByText("s:login")).toBeInTheDocument();
  });
  it("hides the scrubber when no slices are provided (Phase 1 behavior unchanged)", () => {
    renderTab();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- map.test`
Expected: FAIL (`./MapScrubber` does not exist; MapTab has no `slices` prop).

- [ ] **Step 3: Implement the scrubber + MapTab replay mode**

`web/src/dashboard/components/MapScrubber.tsx`:

```tsx
/** Growth-replay scrubber. value === null ⇒ live (slider parked at max). */
export function MapScrubber({ min, max, value, playing, onChange, onPlayPause }: {
  min: number; max: number; value: number | null; playing: boolean;
  onChange: (v: number | null) => void; onPlayPause: () => void;
}) {
  const v = value ?? max;
  return (
    <div className="mapscrub">
      <button type="button" className="mapscrub-play" onClick={onPlayPause}
        aria-label={playing ? "pause" : "play"}>{playing ? "❚❚" : "▶"}</button>
      <input type="range" aria-label="map time scrubber" min={min} max={max} value={v}
        onChange={(e) => { const n = Number(e.target.value); onChange(n >= max ? null : n); }} />
      <span className="mapscrub-label dim">{value === null ? "live" : new Date(v).toLocaleString()}</span>
    </div>
  );
}
```

`web/src/dashboard/tabs/MapTab.tsx` — additions (imports: `useEffect`, `mapAtTime`, `tsMillis`, `type LoopSlice` from `../mapTimeline`, `MapScrubber`):

```tsx
export interface MapTabProps {
  // …existing Phase 1 props…
  slices?: LoopSlice[];        // Phase 2: all-loops run data (useLoopTrend fetch layer)
  projectCreatedAt?: unknown;  // Phase 2: scrubber range start
}
```

Inside `MapTab`, after the live `graph` memo:

```tsx
  const [scrubT, setScrubT] = useState<number | null>(null); // null = live
  const [playing, setPlaying] = useState(false);
  const maxT = useMemo(() => Date.now(), []);                // replay range end, fixed at mount
  const minT = tsMillis(projectCreatedAt) ?? maxT - 1;

  // Play: ~10s sweep (100 ticks × 100ms); reaching max ⇒ back to live.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setScrubT((prev) => {
        const next = (prev ?? minT) + (maxT - minT) / 100;
        if (next >= maxT) { setPlaying(false); return null; }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, minT, maxT]);

  const replay = slices !== undefined && scrubT !== null;
  const shown = replay ? mapAtTime({ goals, scenarios, slices, cutoff: scrubT }) : graph;
```

Render changes: `MapCanvas` gets `nodes={shown.nodes} edges={shown.edges} onNodeClick={replay ? undefined : setPickedNode}` (replay ids are loop-scoped — click-through is live-mode only), and below the canvas:

```tsx
      {slices !== undefined && (
        <MapScrubber min={minT} max={maxT} value={scrubT} playing={playing}
          onChange={(v) => { setScrubT(v); if (v === null) setPlaying(false); }}
          onPlayPause={() => { setPlaying((p) => !p); if (!playing && scrubT === null) setScrubT(minT); }} />
      )}
```

CSS append to `web/src/index.css`:

```css
.mapscrub { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.mapscrub input[type="range"] { flex: 1; }
.mapscrub-play { min-width: 34px; }
.mapscrub-label { font-size: 12px; min-width: 140px; text-align: right; }
```

- [ ] **Step 4: Wire data in `ProjectDetail`**

`web/src/dashboard/ProjectDetail.tsx` — three edits, reusing the `trend` already in scope from the trends plan (`const trend = useLoopTrend(teamId, slug, hasProjectDirectData);` — `includeMain` is already handled there via `hasProjectDirectData`, the same detection `buildLoopList` uses):

1. Imports: add `useMemo` to the existing `react` import, `MAIN_ID` to the existing `./loopView` import, and:

```tsx
import type { LoopSlice } from "./mapTimeline";
```

2. After the `const trendPoints = …` line (trends plan Task 6), map `LoopRunData[]` → `LoopSlice[]`. The `main` slice arrives as `loop.id === MAIN_ID` and maps to `loopId: undefined` (project-direct: no hue band, unscoped node ids — matching the `mapTimeline` convention); `taskCommits` is dropped (the map needs no token data). `undefined` while loading keeps the scrubber hidden until every slice has arrived:

```tsx
  // Map tab replay data: undefined until the trend fan-out has fully arrived
  // (MapTab hides the scrubber when slices === undefined).
  const mapSlices: LoopSlice[] | undefined = useMemo(
    () => trend.loading ? undefined
        : trend.data.map((d) => ({
            loopId: d.loop.id === MAIN_ID ? undefined : d.loop.id,
            tasks: d.tasks, bugs: d.bugs, scores: d.scores, testRuns: d.testRuns,
          })),
    [trend.loading, trend.data]);
```

3. Pass both new props in the map branch:

```tsx
   {tab === "map" && (
     <MapTab /* …existing props… */ slices={mapSlices} projectCreatedAt={project.data?.createdAt} />
   )}
```

(No `dataError` change — the trends plan already surfaces `trend.error`. Do NOT add trend loading to `tabLoading`: the live map renders immediately; the scrubber appears when the fan-out is ready.)

- [ ] **Step 5: Phase 2 gate — full web build + suite**

Run: `cd web && npm run build && npm test`
Expected: build clean; ALL web suites green (Phase 2 is shippable here).

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/components/MapScrubber.tsx web/src/dashboard/tabs/MapTab.tsx web/src/dashboard/ProjectDetail.tsx web/src/index.css web/src/dashboard/components/map.test.tsx
git commit -m "feat(web): growth-replay scrubber on the Map tab (play/pause, live-at-max)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 3 — architecture layer

### Task 8: `contentFormat` gains `"json"` (functions)

**Files:**
- Modify: `functions/src/schemas.ts:10` (the `contentFormat` enum)
- Test: `functions/test/documents.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/documents.test.ts` (reuse its existing app/seed helpers and auth pattern — model on the `format: "markdown"` cases at ~lines 19–40):

```ts
  it("accepts format json and stores it", async () => {
    // …same seed as the markdown create test…
    const res = await request(app).put("/v1/teams/team1/projects/acme/documents/product-map").set(authHeader())
      .send({ kind: "product-map", title: "Product map", format: "json", content: '{"nodes":[],"edges":[]}' });
    expect(res.status).toBe(200);
    const d = (await db().doc("teams/team1/projects/acme/documents/product-map").get()).data()!;
    expect(d.format).toBe("json");
    expect(d.content).toBe('{"nodes":[],"edges":[]}');
  });

  it("rejects an unknown format", async () => {
    const res = await request(app).put("/v1/teams/team1/projects/acme/documents/d2").set(authHeader())
      .send({ kind: "notes", title: "N", format: "yaml", content: "x" });
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- documents` (emulator running; else `npm test`)
Expected: FAIL (`json` rejected by the enum). The `yaml` test may already pass — keep it as the regression guard.

- [ ] **Step 3: Implement**

`functions/src/schemas.ts` line 10:

```ts
const contentFormat = z.enum(["markdown", "url", "json"]);
```

(Purely additive: `documentBody` and `design` both reuse this enum; existing docs unaffected. No service change — `documents.ts` stores `format` opaquely. No rules change — the recursive project-subtree rule already covers documents.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- documents && npm run build`
Expected: PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add functions/src/schemas.ts functions/test/documents.test.ts
git commit -m "feat(contract): documents accept format \"json\" (additive enum value)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `DocumentsSection` json branch (web)

**Files:**
- Modify: `web/src/dashboard/types.ts` (`DocumentRec.format` union + `"json"`)
- Modify: `web/src/dashboard/components/DocumentsSection.tsx`
- Test: `web/src/dashboard/components/vision.test.tsx` (extend the `DocumentsSection` block)

> Context: commit `59a0ef2`'s code-block heuristic was reverted by `c824396` — today ALL
> non-url docs go through react-markdown, which would mangle raw JSON. This branch is new work.

- [ ] **Step 1: Write the failing test**

Add to the `describe("DocumentsSection", …)` block in `web/src/dashboard/components/vision.test.tsx`:

```tsx
  it("renders json documents as a preformatted block, not through react-markdown", () => {
    const { container } = render(<DocumentsSection documents={[
      { id: "product-map", kind: "product-map", title: "Product map", format: "json", content: '{"nodes":[{"id":"api"}]}' },
    ]} />);
    const pre = container.querySelector("pre.docrow-json");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe('{"nodes":[{"id":"api"}]}');
    expect(container.querySelector(".md")).toBeNull(); // no react-markdown wrapper
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- vision`
Expected: FAIL (type error on `format: "json"` and/or no `pre.docrow-json`).

- [ ] **Step 3: Implement**

`web/src/dashboard/types.ts`:

```ts
export interface DocumentRec { id: string; kind?: string; title?: string; format?: "markdown" | "url" | "json"; content?: string; }
```

`web/src/dashboard/components/DocumentsSection.tsx` — replace the body ternary (the head/title ternary is unchanged; only url titles are links):

```tsx
            {d.format === "url"
              ? <span className="docrow-url dim mono">{d.content}</span>
              : d.format === "json"
                ? <pre className="docrow-json mono">{d.content}</pre>
                : <Markdown>{d.content ?? ""}</Markdown>}
```

Append to `web/src/index.css`:

```css
.docrow-json { font-size: 12px; overflow-x: auto; white-space: pre; margin: 6px 0 0; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test -- vision`
Expected: PASS (existing markdown/url cases still green).

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/components/DocumentsSection.tsx web/src/index.css web/src/dashboard/components/vision.test.tsx
git commit -m "feat(web): render format=json documents as preformatted code, not markdown

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: CLI `doc add --format` override + 3-copy sync

**Files:**
- Modify: `cli/autoloop.mjs` (`doc add` case, ~line 424 — today format is inferred: `--file` ⇒ `markdown`, `--url` ⇒ `url`; there is NO `--format` flag and the file flag is `--file`)
- Modify (generated): `web/public/skill/autoloop.mjs`, `plugins/autoloop/bin/autoloop` (via the sync script)
- Test: `functions/test/cli.unit.test.ts` (extend the "goal/scenario/task/doc verbs" block)

- [ ] **Step 1: Write the failing tests**

Add to the `describe("goal/scenario/task/doc verbs (request shapes)", …)` block in `functions/test/cli.unit.test.ts` (`writeFileSync`/`join` are already imported at the top):

```ts
  it("doc add --format json overrides the --file ⇒ markdown inference", async () => {
    const dir = initDir(); const c = cap();
    writeFileSync(join(dir, "map.json"), '{"nodes":[],"edges":[]}');
    expect(await run(["doc", "add", "--id", "product-map", "--kind", "product-map", "--title", "Product map",
      "--format", "json", "--file", "map.json"], base(dir, c))).toBe(0);
    expect(c.url).toBe("http://api/v1/teams/acme/projects/web/documents/product-map");
    expect(JSON.parse(c.init.body)).toMatchObject({ kind: "product-map", title: "Product map", format: "json", content: '{"nodes":[],"edges":[]}' });
  });

  it("doc add without --format keeps the --file ⇒ markdown inference", async () => {
    const dir = initDir(); const c = cap();
    writeFileSync(join(dir, "notes.md"), "# Notes");
    expect(await run(["doc", "add", "--kind", "notes", "--title", "Notes", "--file", "notes.md"], base(dir, c))).toBe(0);
    expect(JSON.parse(c.init.body)).toMatchObject({ format: "markdown", content: "# Notes" });
  });

  it("doc add rejects an unknown --format without calling the API", async () => {
    const dir = initDir();
    const code = await run(["doc", "add", "--kind", "n", "--title", "N", "--format", "yaml", "--url", "https://x.com"],
      { cwd: dir, env: { AUTOLOOP_API_KEY: "al_k" }, log: () => {}, err: () => {}, fetchImpl: async () => { throw new Error("should not be called"); } });
    expect(code).not.toBe(0);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: FAIL (the override test sends `format: "markdown"`; the unknown-format test exits 0).

- [ ] **Step 3: Implement**

In `cli/autoloop.mjs`, inside `case "doc add"` — immediately **after** the existing infer-format/content block (`} else { format = "url"; content = flags.url; }`), add the override (everything else — `--id`/slug, `--file` read, the API-base note — stays as-is):

```js
        if (flags.format) {
          if (!["markdown", "url", "json"].includes(flags.format)) {
            throw new UsageError(`--format must be markdown|url|json, got '${flags.format}'`);
          }
          format = flags.format;
        }
```

If the usage/help text lists `doc add` flags, add `[--format markdown|url|json]` there too (grep for the usage string; mirror existing flag docs).

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm run test:run -- cli.unit`
Expected: PASS.

- [ ] **Step 5: Sync the three copies and verify identical**

```bash
bash scripts/sync-autoloop-cli.sh
diff cli/autoloop.mjs plugins/autoloop/bin/autoloop && diff cli/autoloop.mjs web/public/skill/autoloop.mjs && echo IDENTICAL
```
Expected: `✓ synced …` lines, then `IDENTICAL`.

- [ ] **Step 6: Commit**

```bash
git add cli/autoloop.mjs plugins/autoloop/bin/autoloop web/public/skill/autoloop.mjs functions/test/cli.unit.test.ts
git commit -m "feat(cli): doc add --format markdown|url|json override (beats --file inference)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: `productMapSchema` + component nodes in `buildMap`

**Files:**
- Modify: `web/package.json` (+ `zod` — see the Conventions deviation note)
- Modify: `web/src/dashboard/mapView.ts`
- Test: `web/src/dashboard/mapView.test.ts` (extend)

- [ ] **Step 1: Install zod**

Run: `cd web && npm install zod`
Expected: clean.

- [ ] **Step 2: Write the failing tests**

Add to `web/src/dashboard/mapView.test.ts`:

```ts
describe("buildMap product-map layer", () => {
  const pm = JSON.stringify({
    nodes: [
      { id: "web", label: "Web app", kind: "service", scenarioIds: ["login", "logout"] },
      { id: "api", label: "REST API", kind: "service", scenarioIds: ["login"] },
      { id: "infra", label: "Infra", kind: "service" },
      { id: "ghosty", label: "Ghost refs", scenarioIds: ["nope"] },
    ],
    edges: [{ from: "web", to: "api" }, { from: "web", to: "missing" }],
  });

  it("adds c:-namespaced component nodes with worst-of-scenarios state", () => {
    const g = graph({ productMap: pm });
    // login is bugged (open high b1) → web (login+logout) bugged; api (login) bugged too
    expect(byId(g, "c:web")?.state).toBe("bugged");
    expect(byId(g, "c:web")?.type).toBe("component");
    // no high bug on logout-only ⇒ exercise unmet: a component on only logout
    const g2 = graph({ productMap: JSON.stringify({ nodes: [{ id: "x", label: "X", scenarioIds: ["logout"] }] }) });
    expect(byId(g2, "c:x")?.state).toBe("unmet");
    const g3 = graph({ productMap: JSON.stringify({ nodes: [{ id: "y", label: "Y", scenarioIds: ["login"] }] }), openBugs: [] });
    expect(byId(g3, "c:y")?.state).toBe("met"); // no bugs → login is met
  });
  it("components with no (resolvable) scenarios are neutral", () => {
    const g = graph({ productMap: pm });
    expect(byId(g, "c:infra")?.state).toBe("neutral");
    expect(byId(g, "c:ghosty")?.state).toBe("neutral"); // dangling scenarioId ignored
  });
  it("builds component→scenario and component→component edges, dropping dangling ones", () => {
    const g = graph({ productMap: pm });
    expect(g.edges.some((e) => e.from === "c:web" && e.to === "s:login")).toBe(true);
    expect(g.edges.some((e) => e.from === "c:web" && e.to === "c:api")).toBe(true);
    expect(g.edges.some((e) => e.to === "c:missing")).toBe(false);
    expect(g.edges.some((e) => e.to === "s:nope")).toBe(false);
  });
  it("invalid JSON ⇒ warning, base graph intact, never throws", () => {
    const g = graph({ productMap: "{not json" });
    expect(g.warning).toMatch(/not valid JSON/i);
    expect(byId(g, "s:login")).toBeDefined();
    expect(g.nodes.some((n) => n.type === "component")).toBe(false);
  });
  it("schema-invalid content ⇒ warning", () => {
    expect(graph({ productMap: '{"nodes":[{"id":"NO SPACES","label":""}]}' }).warning).toMatch(/expected shape/i);
  });
  it("oversized content (>100KB) ⇒ warning without parsing", () => {
    expect(graph({ productMap: "x".repeat(100 * 1024 + 1) }).warning).toMatch(/100KB/);
  });
  it("no productMap ⇒ no warning key", () => {
    expect(graph().warning).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npm test -- mapView`
Expected: FAIL (no component nodes, no `warning`).

- [ ] **Step 4: Implement**

Add to `web/src/dashboard/mapView.ts`:

```ts
import { z } from "zod";

export const PRODUCT_MAP_MAX_BYTES = 100 * 1024;
const componentNode = z.object({
  id: z.string().regex(/^[a-z0-9._-]+$/),
  label: z.string().min(1),
  kind: z.string().optional(),
  scenarioIds: z.array(z.string()).optional(),
});
export const productMapSchema = z.object({
  nodes: z.array(componentNode),
  edges: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
});
export type ProductMap = z.infer<typeof productMapSchema>;

/** Parse + validate the agent-maintained product-map document. Never throws. */
function parseProductMap(content: string): { map: ProductMap } | { warning: string } {
  if (content.length > PRODUCT_MAP_MAX_BYTES) {
    return { warning: "product-map document exceeds 100KB — architecture layer not rendered" };
  }
  let raw: unknown;
  try { raw = JSON.parse(content); }
  catch { return { warning: "product-map document is not valid JSON — architecture layer not rendered" }; }
  const parsed = productMapSchema.safeParse(raw);
  if (!parsed.success) return { warning: "product-map document does not match the expected shape — architecture layer not rendered" };
  return { map: parsed.data };
}
```

In `buildMap`, replace the final `return { nodes, edges };` with:

```ts
  let warning: string | undefined;
  if (input.productMap !== undefined) {
    const parsed = parseProductMap(input.productMap);
    if ("warning" in parsed) {
      warning = parsed.warning;
    } else {
      const scnState = new Map(nodes.filter((n) => n.type === "scenario").map((n) => [n.id, n.state]));
      for (const c of parsed.map.nodes) {
        const states = (c.scenarioIds ?? [])
          .map((sid) => scnState.get(`s:${sid}`))
          .filter((s): s is MapNodeState => s !== undefined);
        // Worst-of-scenarios: any bugged → bugged, else any unmet → unmet, else met; none → neutral.
        const state: MapNodeState = states.length === 0 ? "neutral"
          : states.includes("bugged") ? "bugged"
          : states.includes("unmet") ? "unmet"
          : "met";
        nodes.push({ id: `c:${c.id}`, type: "component", label: c.label, state });
      }
      const allIds = new Set(nodes.map((n) => n.id));
      for (const c of parsed.map.nodes) {
        for (const sid of c.scenarioIds ?? []) if (allIds.has(`s:${sid}`)) edges.push({ from: `c:${c.id}`, to: `s:${sid}` });
      }
      for (const e of parsed.map.edges ?? []) {
        if (allIds.has(`c:${e.from}`) && allIds.has(`c:${e.to}`)) edges.push({ from: `c:${e.from}`, to: `c:${e.to}` });
      }
    }
  }
  return warning === undefined ? { nodes, edges } : { nodes, edges, warning };
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npm test -- mapView && npm test -- mapTimeline`
Expected: both PASS (mapTimeline never passes `productMap` — unaffected).

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/dashboard/mapView.ts web/src/dashboard/mapView.test.ts
git commit -m "feat(web): product-map architecture layer — zod-validated component nodes, worst-of state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: MapTab wiring — warning card + component panel

**Files:**
- Modify: `web/src/dashboard/tabs/MapTab.tsx` (`productMap` prop, warning card, `c:` panel branch)
- Modify: `web/src/dashboard/ProjectDetail.tsx` (pass the reserved document's content)
- Test: `web/src/dashboard/components/map.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `web/src/dashboard/components/map.test.tsx`:

```tsx
describe("MapTab product-map layer", () => {
  it("renders component nodes and a label card on click", () => {
    renderTab({ productMap: JSON.stringify({ nodes: [{ id: "api", label: "REST API", scenarioIds: ["login"] }] }) });
    fireEvent.click(screen.getByText("c:api"));
    expect(screen.getByText("REST API")).toBeInTheDocument();
  });
  it("shows a warning card (not a crash) on malformed content, and still renders the base graph", () => {
    renderTab({ productMap: "{broken" });
    expect(screen.getByRole("note")).toHaveTextContent(/not valid JSON/i);
    expect(screen.getByText("s:login")).toBeInTheDocument();
  });
  it("shows no warning card without a product map", () => {
    renderTab();
    expect(screen.queryByRole("note")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test -- map.test`
Expected: FAIL (no `productMap` prop).

- [ ] **Step 3: Implement**

`MapTab.tsx`:
1. Add `productMap?: string;` to `MapTabProps` and thread it into the `buildMap` call (and its memo deps).
2. Render the warning card above the canvas:
   ```tsx
   {graph.warning && <div className="card map-warning" role="note">{graph.warning}</div>}
   ```
3. Add a `c:` branch to `MapPanelBody` — components live only in the document, so show the node's label (pass `nodes` in `PanelData`):
   ```tsx
   if (ns === "c") {
     const n = data.nodes.find((x) => x.id === id);
     return n ? <div className="map-goal"><h3>{n.label}</h3><p className="dim">component</p></div> : null;
   }
   ```
   (Add `nodes: MapNode[]` to `PanelData` and pass `graph.nodes` from `MapTab`.)

`ProjectDetail.tsx` — the documents hook is already there; pass the reserved doc:

```tsx
   {tab === "map" && (
     <MapTab /* …existing props… */
       productMap={documents.data.find((d) => d.id === "product-map")?.content} />
   )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test -- map.test && npm run build`
Expected: PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/tabs/MapTab.tsx web/src/dashboard/ProjectDetail.tsx web/src/dashboard/components/map.test.tsx
git commit -m "feat(web): render the agent-reported architecture layer on the Map tab (warning on malformed)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Driver skill — maintain the product map (Step 2e) + plugin bump

**Files:**
- Modify: `plugins/autoloop/skills/autoloop/SKILL.md` (Step 2e, ~line 137)
- Modify: `plugins/autoloop/.claude-plugin/plugin.json` (version bump)
- Modify (generated): `web/public/skill/autoloop/SKILL.md` (via the sync script)

- [ ] **Step 1: Add the Step 2e bullet**

In `plugins/autoloop/skills/autoloop/SKILL.md`, in **Step 2e** ("Evaluate, revise, drain messages"), after the "If a scenario is unmet" bullet, add:

````markdown
- **If the task added or reshaped components** (a new module/service/screen, a moved
  boundary): update the product map. Maintain `map.json` in the repo — read the existing
  one if any (or start from `{"nodes":[],"edges":[]}`), **merge** the new/changed
  components and edges into it (never replace wholesale, never send a fragment — the
  upload is an idempotent PUT of the full map), then:

  ```bash
  autoloop doc add --id product-map --kind product-map --title "Product map" --format json --file map.json
  ```

  Shape: `{"nodes":[{"id":"api","label":"REST API","kind":"service","scenarioIds":["login-works"]}],"edges":[{"from":"web","to":"api"}]}` —
  node ids lowercase (`[a-z0-9._-]`), `scenarioIds` reference vision scenarios. Keep it
  **coarse**: components are modules/services/screens, not files.
````

- [ ] **Step 2: Bump the plugin version**

`plugins/autoloop/.claude-plugin/plugin.json`: `"version": "0.10.1"` → `"version": "0.11.0"`.

- [ ] **Step 3: Sync the skill copies**

```bash
bash scripts/sync-autoloop-cli.sh
diff plugins/autoloop/skills/autoloop/SKILL.md web/public/skill/autoloop/SKILL.md && echo IDENTICAL
```
Expected: `✓ synced …`, then `IDENTICAL`.

- [ ] **Step 4: Commit**

```bash
git add plugins/autoloop/skills/autoloop/SKILL.md plugins/autoloop/.claude-plugin/plugin.json web/public/skill/autoloop/SKILL.md
git commit -m "feat(skill): driver maintains the product-map document after component-shaping tasks (v0.11.0)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Full gates

**Files:** none (verification only; commit anything the sync regenerates).

- [ ] **Step 1: CLI copies identical**

```bash
bash scripts/sync-autoloop-cli.sh
diff cli/autoloop.mjs plugins/autoloop/bin/autoloop && diff cli/autoloop.mjs web/public/skill/autoloop.mjs && echo IDENTICAL
```
Expected: `IDENTICAL`.

- [ ] **Step 2: Web — build + full suite**

Run: `cd web && npm run build && npm test`
Expected: build clean; ALL web suites green (mapView, mapTimeline, map.test, shell, vision, plus every pre-existing suite — zero regression).

- [ ] **Step 3: Functions — build + full suite + rules**

Run: `cd functions && npm run build && npm test && npm run test:rules`
Expected: build clean; ALL main suites green (documents + cli.unit extensions included); rules suite green (no rules change was made).

- [ ] **Step 4: Commit anything outstanding**

```bash
git status --porcelain   # expect empty; if the sync regenerated copies, add + commit them:
git add -A && git commit -m "chore: sync generated CLI/skill copies

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Definition of done

- **Phase 1:** Map tab (between Bugs and Messages) shows the goal→scenario→task→bug DAG with correct met/unmet/active/bugged coloring (terminal tasks dimmed via `done`), the running task pulsing live via existing listeners, LoopSelector visible, click-through side panel reusing ScenarioCard/TaskItem/BugItem, empty state without goals. `buildMap` fully unit-tested incl. namespacing, dangling-edge dropping, bug edge fallback.
- **Phase 2:** the scrubber replays growth from project `createdAt` to now (play/pause ≈10s sweep, release-at-max ⇒ live); `mapAtTime` is pure and monotonic (entities never vanish as T advances; open-at-T bugs are the sanctioned exception); each loop's additions carry a deterministic hue band.
- **Phase 3:** documents accept `format: "json"`; `DocumentsSection` renders json as a code block (not react-markdown); `doc add --format` overrides inference (3 CLI copies identical); a loop-maintained `product-map` document renders as dashed component nodes with worst-of-scenarios state and component→component/scenario edges; malformed/oversized content degrades to a warning card, never a crash; the driver skill maintains the map (plugin v0.11.0, skill copies synced).
- `@xyflow/react` + `dagre` (+ `@types/dagre`, and `zod` for web per the flagged deviation) are the only dependency additions; no rules change; web + functions + rules suites all green.

## Out of scope (per spec)

- iOS Map tab (deliberate parity exception).
- Radial growth-rings layout; manual node positioning / persisted layouts.
- File-level architecture graphs or static-analysis-derived maps.
- Server-side validation or interpretation of product-map content.
