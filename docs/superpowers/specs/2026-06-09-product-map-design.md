# Autoloop — Product map (graph screen) design spec

**Date:** 2026-06-09
**Status:** approved (brainstorming) — pending spec review + user review
**Sub-project:** 6 of 6 in the self-evolution batch. A **Map tab** that draws what is
being built as a living graph — goals → scenarios → tasks → bugs colored by met-state,
updating live as the loop runs — with a growth-replay scrubber (watch the seed expand
loop by loop) and an agent-reported architecture layer. Three phases in one spec; each
ships alone.

## Goal

The dashboard explains the build in lists and tabs; the graph is the one view where the
*shape* of the product and its growth are visible at a glance — and the traceability
discipline already forced into the contract (tasks carry `scenarioIds[]`, bugs carry
`scenarioId`/`taskId`, events are replayable by sortable ULID) is exactly an edge list
waiting to be drawn. Phases 1–2 need **zero backend change**; Phase 3 adds one additive
enum value, a reserved document, and a small `doc add --format` CLI override.

## Architecture

- **Phase 1 — derived live map.** A new `MapTab` renders a DAG from data existing hooks
  already deliver. Graph *derivation* is a pure module (`mapView.ts`); *layout* is
  dagre; *interaction* (pan/zoom/minimap/custom nodes) is React Flow. Node state reuses
  `scenarioState.ts`. Live updates ride the existing Firestore listeners.
- **Phase 2 — growth replay.** A pure `mapTimeline.ts` computes "the graph as of time
  T" from `createdAt`s and ULID-ordered events; a scrubber slider drives it. Loops
  visually distinguished by hue band.
- **Phase 3 — architecture layer.** The loop maintains a reserved document
  (`kind: "product-map"`, new `format: "json"`) describing components and their edges
  to scenarios; the Map renders component nodes inheriting met-state from their
  scenarios. One additive `contentFormat` enum value + a small `doc add --format` CLI
  override (3 copies synced) + a `DocumentsSection` json branch + one driver-skill step.

**New web dependencies:** `@xyflow/react` (React Flow, MIT) and `dagre` (layout).
Rejected alternatives: ELK (heavier, web-worker setup, overkill for a shallow DAG);
hand-rolled SVG layout (free pan/zoom/minimap from React Flow outweighs the dependency
cost). No rules change in any phase.

## Phase 1 — derived live map

### Graph derivation — `dashboard/mapView.ts` (pure, fully unit-tested)

```ts
type MapNode = { id: string; type: "goal" | "scenario" | "task" | "bug" | "component";
                 label: string; state: "met" | "unmet" | "active" | "bugged" | "neutral";
                 loopId?: string };
type MapEdge = { from: string; to: string };
buildMap(input: { goals, scenarios, scenarioStates,      // from scenarioState.ts
                  tasks, currentTaskId, openBugs,
                  productMap? }): { nodes: MapNode[]; edges: MapEdge[] }
```

- **Nodes:** all goals (`neutral`); all scenarios (`met`/`unmet`; `bugged` when an
  open `high` bug references it); the **selected loop's** tasks (`active` when
  `id === currentTaskId`, else `neutral`; terminal tasks render dimmed via state
  `neutral` + a `done` flag); open bugs (`bugged`).
- **Edges:** goal→scenario (`scenario.goalId`), scenario→task (`task.scenarioIds`),
  task→bug (`bug.taskId`, falling back to scenario→bug via `bug.scenarioId` when no
  task). Edges referencing missing nodes are dropped (defensive; loop data is
  agent-written).
- ID-namespacing (`g:`, `s:`, `t:`, `b:`, `c:`) prevents collisions across collections.

### Rendering — `tabs/MapTab.tsx` + `components/MapCanvas.tsx`

- Layout: dagre `rankdir=LR` (goals left → bugs right), computed in a memo from
  `buildMap` output; React Flow renders with custom node components (color by `state`:
  green met, grey unmet/neutral, pulsing amber `active`, red `bugged`) + minimap +
  fit-view. The currently-running task **pulses** (CSS animation) — live via existing
  listeners, no polling.
- Node click → a detail side panel reusing existing components (`ScenarioCard`,
  `TaskItem`, `BugItem`) for the clicked entity.
- LoopSelector stays visible (tasks/bugs are loop-scoped; vision is project-level —
  same convention as the Loops tab). Empty state when the vision has no goals.
- Tab order: …Bugs, **Map**, Messages.

## Phase 2 — growth replay

- **`dashboard/mapTimeline.ts` (pure):** given the same inputs plus all loops' events,
  and a cutoff timestamp `T`: filter entities to `createdAt <= T` and evaluate scenario
  met-state using only events with `createdAt <= T` (latest-by-ULID within the cutoff —
  reusing the `scenarioState` event-subset predicate from the trends sub-project, or
  introducing it here if Map ships first; whichever lands second reuses). Returns the
  same `{nodes, edges}` shape.
- **Scrubber UI:** a slider from project `createdAt` to now with play/pause (~10s
  sweep); while scrubbing, `MapCanvas` renders `mapTimeline(T)`; released at max ⇒ back
  to live mode. Nodes carry `loopId` → per-loop hue band so each loop's additions read
  as a growth ring even in the LR layout. (A radial rings layout is explicitly a
  stretch goal, not committed.)
- Data: reuses the bounded all-loops fan-out hook built for trends (`useLoopTrend`'s
  fetch layer, window-capped and labeled the same way). Note: the web `Goal`/
  `Scenario`/`Task` types don't currently declare `createdAt` — the services stamp it
  and the hooks spread the raw doc, so this is a one-line type extension per entity.

## Phase 3 — architecture layer

### Contract (additive)

- `contentFormat` enum gains `"json"` (documents). Generic document rendering needs a
  **new** small branch in `DocumentsSection.tsx`: `format === "json"` ⇒ preformatted
  code block (note: commit 59a0ef2's code-block heuristic was reverted by c824396 —
  today all non-url docs go through react-markdown, which would mangle raw JSON, so
  this branch is new work, not existing behavior). Purely additive: existing docs
  unaffected.
- **CLI change (+ sync of the three copies):** `doc add` today has no `--format`
  flag (format is inferred: `--file` ⇒ `markdown`, `--url` ⇒ `url`), no positional
  id (id comes from `--id` or slugified `--title`), and the file flag is `--file`,
  not `--content-file`. Add an explicit `--format markdown|url|json` override to
  `doc add`; everything else stays as-is.
- **Reserved document:** id/kind `product-map`, `format: "json"`, content:

```json
{ "nodes": [{ "id": "api", "label": "REST API", "kind": "service",
              "scenarioIds": ["login-works"] }],
  "edges": [{ "from": "web", "to": "api" }] }
```

Parsed and zod-validated **client-side** in `mapView.ts` (`productMapSchema`); invalid
or >100KB content ⇒ the Map shows a small warning card and renders without the layer
(never crashes the tab). No server-side interpretation — the server stores a document
like any other (one less coupling).

### Map integration

Component nodes (`type: "component"`, distinct shape) join the graph; edges
component→scenario from `scenarioIds` and component→component from `edges`. A
component's state is the **worst** of its scenarios' states (any bugged → bugged, else
any unmet → unmet, else met; no scenarios → neutral).

### Driver skill

Step 2e addition: after each task that adds or reshapes components, update the product
map — read the current `product-map` document if any, merge nodes/edges, and
`autoloop doc add --id product-map --kind product-map --title "Product map"
--format json --file map.json` (idempotent PUT; uses the `--format` override added
above). Keep it coarse: components are modules/services/screens, not files. Plugin
bump; sync skill copies.

## Testing

- **`mapView`:** node/state derivation (met/unmet/active/bugged precedence), edge
  building incl. dangling-reference dropping, namespacing, product-map merge +
  worst-of-scenarios state, invalid product-map JSON ⇒ warning flag not throw.
- **`mapTimeline`:** entities/events cutoff filtering, met-at-T via latest-within-cutoff,
  monotonic growth (nodes never disappear as T advances).
- **Components (vitest + RTL):** MapTab renders nodes per state, click opens the
  panel, empty state, warning card. Layout/React Flow internals are not snapshot-tested
  (third-party); we test our derivation and wiring.
- **API (Phase 3 only):** documents accept `format: "json"` (enum), reject unknown
  formats — existing document tests extended.
- **CLI (Phase 3 only):** `doc add --format json --file map.json` sends
  `format: "json"` (override beats the `--file ⇒ markdown` inference); existing
  inference unchanged without the flag; three copies synced.
- **Web (Phase 3):** `DocumentsSection` renders `format: "json"` as a preformatted
  code block, not through react-markdown.

## Back-compat

Phases 1–2 are web-only. Phase 3's enum extension is additive; the reserved id only
has meaning to the Map (other views render it as a JSON document like any other).

## Out of scope

- iOS Map tab (deliberate parity exception for now).
- Radial growth-rings layout (stretch); manual node positioning/persisted layouts.
- File-level architecture graphs or static-analysis-derived maps (the loop reports
  coarse components; we don't parse the repo).
- Server-side validation of product-map content.

## Success criteria

- Map tab shows the goal→scenario→task→bug graph with correct met/active/bugged
  coloring, updating live while a loop runs, with click-through detail.
- The scrubber replays growth from seed to now; each loop's additions are visually
  distinguishable.
- A loop-maintained `product-map` document renders as component nodes with inherited
  state; a malformed one degrades to a warning.
- All suites green; the two new deps are the only additions; no rules change.
