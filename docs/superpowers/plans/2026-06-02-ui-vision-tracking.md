# Vision Tracking UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the full vision-driven loop on the existing project page — an "N/M scenarios met" banner, the vision (goals → scenarios with derived met/unmet state + latest score + latest test), the phase→task tree with task-scoped commits, the revision timeline, and documents — read-only, additive, with legacy phase-mode projects unchanged.

**Architecture:** A pure client-side derivation helper (`scenarioState.ts`, unit-tested) computes `scenario.state` from scores+testRuns. New `Result<T>`+`onSnapshot` hooks read each loop subcollection. New presentational components render each section and are composed into `ProjectDetail.tsx`, each section conditional on its data so legacy projects fall back to today's phases+phase-commits rendering. No API, CLI, or Firestore-rules change.

**Tech Stack:** React + react-router-dom + Firebase JS SDK (`onSnapshot`), Vitest + jsdom + @testing-library/react (existing `web` harness), the single `web/src/index.css` design system (espresso/gold).

**Reference spec:** `docs/superpowers/specs/2026-06-02-ui-vision-tracking-design.md`

---

## Background / conventions (read before Task 1)

- **Hook pattern** (`web/src/dashboard/hooks.ts`): every hook returns `Result<T> = { data, loading, error }` and is a `useEffect` that calls `onSnapshot` on a collection/doc and returns the unsubscribe. Mirror `usePhases` (collection + `orderBy`) and `useCommits` (nested collection). Import `documentId` from `firebase/firestore` for id-ordered event collections.
- **Derivation lives in a pure module** (`scenarioState.ts`) — no Firebase imports — so it's unit-testable. Components stay presentational (props in, JSX out) and are render-tested with props (see `web/src/dashboard/components/detail.test.tsx`); they do NOT call Firestore.
- **`scenario.state` rule (from the contract):** filter scores/testRuns to the scenario id, take the **latest by document id** (ULID lexical max), `met` iff `latestScore.composite ≥ (threshold ?? 80)` AND `latestTestRun.failed === 0`; missing score or test ⇒ `unmet`.
- **Legacy fallback is load-bearing:** if a project has **no tasks**, `PlanSection` must render the existing phases+phase-commits markup **exactly** as today's `ProjectDetail` (same "Phases" header, `PhaseItem`, `useCommits`) — existing projects must not regress.
- **Styling:** add new classes to `web/src/index.css`. Reuse existing where possible: `card`, `chip`, `mono`, `tnum`, `empty`, `badge`/`StatusBadge`, `proj-section-head`/`proj-section-title`, `back`. Component **tests assert text/structure, not CSS**, so CSS can land with the composition task.
- **Commands:** `cd web && npm test` (vitest run, jsdom) for all web tests; `cd web && npm run build` (tsc -b && vite build) to type-check + build. Run a single test file: `cd web && npx vitest run src/dashboard/<file>`.
- Do NOT `git add -A` (pre-existing untracked `.DS_Store`/`prototype/`); add named paths.
- All new code is under `web/src/dashboard/`. No changes outside `web/` (no API/rules/CLI).

## File structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/dashboard/types.ts` | add `Goal`, `Scenario`, `Task`, `Score`, `TestRun`, `Revision`, `DocumentRec` | 1 |
| `web/src/dashboard/scenarioState.ts` | pure `deriveScenarioState`, `latestById`, `summarize` | 1 |
| `web/src/dashboard/scenarioState.test.ts` | unit tests for the helper | 1 |
| `web/src/dashboard/hooks.ts` | add `useGoals/useScenarios/useTasks/useTaskCommits/useScores/useTestRuns/useRevisions/useDocuments` | 2 |
| `web/src/dashboard/components/ScenariosMetBanner.tsx` | "N/M scenarios met" banner | 3 |
| `web/src/dashboard/components/ScenarioCard.tsx` | one scenario: badge, composite bar, latest test, score history | 3 |
| `web/src/dashboard/components/VisionSection.tsx` | goals → their scenario cards | 3 |
| `web/src/dashboard/components/TaskItem.tsx` | one task: status, scenarioIds, task commits | 4 |
| `web/src/dashboard/components/PlanSection.tsx` | phase→task tree + legacy fallback | 4 |
| `web/src/dashboard/components/RevisionTimeline.tsx` | revisions in id order | 5 |
| `web/src/dashboard/components/DocumentsSection.tsx` | documents list | 5 |
| `web/src/dashboard/components/vision.test.tsx` | render tests (banner, ScenarioCard, PlanSection legacy) | 3–5 |
| `web/src/dashboard/ProjectDetail.tsx` | compose all sections (conditional) | 6 |
| `web/src/index.css` | new section/card/bar/timeline classes | 6 |

---

## Task 1: Types + pure `scenarioState` helper + unit tests

**Files:**
- Modify: `web/src/dashboard/types.ts`
- Create: `web/src/dashboard/scenarioState.ts`, `web/src/dashboard/scenarioState.test.ts`

- [ ] **Step 1: Add the types** (`web/src/dashboard/types.ts`)

Append (keep the existing `TeamRef`/`Team`/`Project`/`Phase`/`Commit`):

```typescript
export interface RubricCriterion { id: string; name: string; weight: number; max: number; }
export interface Goal { id: string; title?: string; description?: string; order?: number; }
export interface Scenario {
  id: string; goalId?: string; title?: string; description?: string; order?: number;
  threshold?: number; rubric?: { criteria: RubricCriterion[] };
}
export interface Task { id: string; phaseId?: string; title?: string; order?: number; status?: string; scenarioIds?: string[]; }
export interface Score { id: string; scenarioId?: string; taskId?: string; criteria?: Record<string, number>; composite?: number; by?: string; note?: string; commitSha?: string; }
export interface TestRun { id: string; scenarioId?: string; taskId?: string; passed?: number; failed?: number; issues?: string[]; }
export interface RevisionChange { op: string; taskId: string; [k: string]: unknown; }
export interface Revision { id: string; trigger?: { scenarioId?: string; reason?: string }; changes?: RevisionChange[]; }
export interface DocumentRec { id: string; kind?: string; title?: string; format?: "markdown" | "url"; content?: string; }
```

- [ ] **Step 2: Write the failing test** (`web/src/dashboard/scenarioState.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import { deriveScenarioState, latestById, summarize } from "./scenarioState";
import type { Scenario, Score, TestRun } from "./types";

const scenario = (over: Partial<Scenario> = {}): Scenario => ({ id: "s1", goalId: "g1", title: "S", rubric: { criteria: [] }, ...over });
const score = (id: string, composite: number, scenarioId = "s1"): Score => ({ id, scenarioId, composite });
const run = (id: string, failed: number, scenarioId = "s1"): TestRun => ({ id, scenarioId, passed: 1, failed });

describe("latestById", () => {
  it("returns the lexical-max id, regardless of array order", () => {
    expect(latestById([score("01B", 1), score("01A", 2), score("01C", 3)])!.id).toBe("01C");
    expect(latestById([])).toBeNull();
  });
});

describe("deriveScenarioState", () => {
  it("met: latest composite >= threshold AND latest testRun.failed === 0", () => {
    const r = deriveScenarioState(scenario({ threshold: 80 }), [score("01A", 60), score("01B", 85)], [run("01A", 0)]);
    expect(r.state).toBe("met");
    expect(r.latestComposite).toBe(85);
  });
  it("unmet when latest composite < threshold", () => {
    expect(deriveScenarioState(scenario({ threshold: 80 }), [score("01A", 79)], [run("01A", 0)]).state).toBe("unmet");
  });
  it("unmet when latest testRun has failures", () => {
    expect(deriveScenarioState(scenario({ threshold: 80 }), [score("01A", 95)], [run("01A", 2)]).state).toBe("unmet");
  });
  it("met exactly at the threshold", () => {
    expect(deriveScenarioState(scenario({ threshold: 80 }), [score("01A", 80)], [run("01A", 0)]).state).toBe("met");
  });
  it("defaults threshold to 80 when unset", () => {
    expect(deriveScenarioState(scenario({ threshold: undefined }), [score("01A", 80)], [run("01A", 0)]).state).toBe("met");
    expect(deriveScenarioState(scenario({ threshold: undefined }), [score("01A", 79)], [run("01A", 0)]).state).toBe("unmet");
  });
  it("unmet when there is no score or no test run", () => {
    expect(deriveScenarioState(scenario(), [], [run("01A", 0)]).state).toBe("unmet");
    expect(deriveScenarioState(scenario(), [score("01A", 90)], []).state).toBe("unmet");
  });
  it("ignores other scenarios' scores/runs", () => {
    const r = deriveScenarioState(scenario(), [score("01A", 90), score("01Z", 10, "other")], [run("01A", 0)]);
    expect(r.latestComposite).toBe(90);
    expect(r.state).toBe("met");
  });
});

describe("summarize", () => {
  it("counts met / total", () => {
    const scns = [scenario({ id: "s1" }), scenario({ id: "s2" })];
    const scores = [score("01A", 90, "s1"), score("01A", 10, "s2")];
    const runs = [run("01A", 0, "s1"), run("01A", 0, "s2")];
    expect(summarize(scns, scores, runs)).toEqual({ met: 1, total: 2 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/dashboard/scenarioState`
Expected: FAIL — cannot find module `./scenarioState`.

- [ ] **Step 4: Write the implementation** (`web/src/dashboard/scenarioState.ts`)

```typescript
import type { Scenario, Score, TestRun } from "./types";

export const DEFAULT_THRESHOLD = 80;

/** The element with the lexically greatest `id` (events are ULID-keyed → id order == time order). */
export function latestById<T extends { id: string }>(items: T[]): T | null {
  let best: T | null = null;
  for (const it of items) if (best === null || it.id > best.id) best = it;
  return best;
}

export interface ScenarioState { state: "met" | "unmet"; latestComposite: number | null; latestTest: TestRun | null; }

/** Derive a scenario's met/unmet state from its scores + test runs (contract rule). */
export function deriveScenarioState(scenario: Scenario, scores: Score[], testRuns: TestRun[]): ScenarioState {
  const myScores = scores.filter((s) => s.scenarioId === scenario.id);
  const myRuns = testRuns.filter((r) => r.scenarioId === scenario.id);
  const latestScore = latestById(myScores);
  const latestTest = latestById(myRuns);
  const threshold = scenario.threshold ?? DEFAULT_THRESHOLD;
  const composite = latestScore?.composite ?? null;
  const met = composite !== null && composite >= threshold && latestTest !== null && (latestTest.failed ?? 0) === 0;
  return { state: met ? "met" : "unmet", latestComposite: composite, latestTest };
}

/** Count how many scenarios are met. */
export function summarize(scenarios: Scenario[], scores: Score[], testRuns: TestRun[]): { met: number; total: number } {
  let met = 0;
  for (const s of scenarios) if (deriveScenarioState(s, scores, testRuns).state === "met") met++;
  return { met, total: scenarios.length };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/dashboard/scenarioState`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/scenarioState.ts web/src/dashboard/scenarioState.test.ts
git commit -m "feat(web): scenario types + pure scenarioState derivation helper"
```

---

## Task 2: Data hooks for the loop subcollections

**Files:**
- Modify: `web/src/dashboard/hooks.ts`

- [ ] **Step 1: Add the hooks** (`web/src/dashboard/hooks.ts`)

Add `documentId` to the existing `firebase/firestore` import, and import the new types. Then add these hooks, mirroring the existing `usePhases`/`useCommits` exactly (same `Result<T>` shape, `onSnapshot`, cleanup). Ordered collections use `orderBy("order")`; event collections use `orderBy(documentId())`.

```typescript
// add to the firebase/firestore import: documentId
// add to the ./types import: Goal, Scenario, Task, Score, TestRun, Revision, DocumentRec

function useOrderedCol<T>(path: string[], orderField: string): Result<T[]> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, path[0], ...path.slice(1)), orderBy(orderField));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as T[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.join("/"), orderField]);
  return { data, loading, error };
}

export function useGoals(teamId: string, slug: string) {
  return useOrderedCol<Goal>(["teams", teamId, "projects", slug, "goals"], "order");
}
export function useScenarios(teamId: string, slug: string) {
  return useOrderedCol<Scenario>(["teams", teamId, "projects", slug, "scenarios"], "order");
}
export function useTasks(teamId: string, slug: string) {
  return useOrderedCol<Task>(["teams", teamId, "projects", slug, "tasks"], "order");
}
export function useScores(teamId: string, slug: string) {
  return useDocIdCol<Score>(["teams", teamId, "projects", slug, "scores"]);
}
export function useTestRuns(teamId: string, slug: string) {
  return useDocIdCol<TestRun>(["teams", teamId, "projects", slug, "testRuns"]);
}
export function useRevisions(teamId: string, slug: string) {
  return useDocIdCol<Revision>(["teams", teamId, "projects", slug, "revisions"]);
}
export function useDocuments(teamId: string, slug: string) {
  return useDocIdCol<DocumentRec>(["teams", teamId, "projects", slug, "documents"]);
}
export function useTaskCommits(teamId: string, slug: string, taskId: string): Result<Commit[]> {
  const [data, setData] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "tasks", taskId, "commits"), orderBy("createdAt", "desc"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ sha: d.id, ...(d.data() as object) })) as Commit[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug, taskId]);
  return { data, loading, error };
}
```

Add the `useDocIdCol` helper next to `useOrderedCol` (same body but `orderBy(documentId())`):

```typescript
function useDocIdCol<T>(path: string[]): Result<T[]> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, path[0], ...path.slice(1)), orderBy(documentId()));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as T[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.join("/")]);
  return { data, loading, error };
}
```

NOTE: `collection(db, path[0], ...path.slice(1))` — the firebase `collection()` accepts `(db, ...segments)`; spreading is fine. If TypeScript complains about the spread arity, fall back to explicit `collection(db, "teams", teamId, "projects", slug, "goals")` per hook (more verbose but identical behavior) — keep whichever compiles cleanly under `tsc -b`.

- [ ] **Step 2: Type-check / build**

Run: `cd web && npm run build`
Expected: 0 TypeScript errors (the new hooks compile; nothing else changed).

- [ ] **Step 3: Commit**

```bash
git add web/src/dashboard/hooks.ts
git commit -m "feat(web): Firestore hooks for goals/scenarios/tasks/scores/testRuns/revisions/documents/task-commits"
```

---

## Task 3: Banner + ScenarioCard + VisionSection (+ render tests)

**Files:**
- Create: `web/src/dashboard/components/ScenariosMetBanner.tsx`, `ScenarioCard.tsx`, `VisionSection.tsx`
- Create: `web/src/dashboard/components/vision.test.tsx`

- [ ] **Step 1: Write the failing render tests** (`web/src/dashboard/components/vision.test.tsx`)

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenariosMetBanner } from "./ScenariosMetBanner";
import { ScenarioCard } from "./ScenarioCard";
import type { Scenario, Score, TestRun } from "../types";

const scn: Scenario = { id: "login", goalId: "g1", title: "Login works", threshold: 80, rubric: { criteria: [{ id: "c", name: "Correctness", weight: 1, max: 5 }] } };

describe("ScenariosMetBanner", () => {
  it("shows N / M scenarios met", () => {
    render(<ScenariosMetBanner met={3} total={5} />);
    expect(screen.getByText(/3\s*\/\s*5/)).toBeInTheDocument();
    expect(screen.getByText(/scenarios met/i)).toBeInTheDocument();
  });
});

describe("ScenarioCard", () => {
  const scores: Score[] = [{ id: "01A", scenarioId: "login", composite: 92 }];
  const runs: TestRun[] = [{ id: "01A", scenarioId: "login", passed: 6, failed: 0 }];
  it("renders title, met state, composite, and test counts when met", () => {
    render(<ScenarioCard scenario={scn} scores={scores} testRuns={runs} />);
    expect(screen.getByText("Login works")).toBeInTheDocument();
    expect(screen.getByText(/met/i)).toBeInTheDocument();
    expect(screen.getByText(/92/)).toBeInTheDocument();
    expect(screen.getByText(/6/)).toBeInTheDocument(); // passed
  });
  it("shows unmet when below threshold", () => {
    render(<ScenarioCard scenario={scn} scores={[{ id: "01A", scenarioId: "login", composite: 50 }]} testRuns={runs} />);
    expect(screen.getByText(/unmet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/dashboard/components/vision`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the components**

`ScenariosMetBanner.tsx`:
```tsx
export function ScenariosMetBanner({ met, total }: { met: number; total: number }) {
  const allMet = total > 0 && met === total;
  return (
    <div className={`metbanner card${allMet ? " metbanner--all" : ""}`}>
      <span className="metbanner-num tnum">{met} / {total}</span>
      <span className="metbanner-label">scenarios met</span>
    </div>
  );
}
```

`ScenarioCard.tsx`:
```tsx
import { deriveScenarioState, DEFAULT_THRESHOLD, latestById } from "../scenarioState";
import type { Scenario, Score, TestRun } from "../types";

export function ScenarioCard({ scenario, scores, testRuns }: { scenario: Scenario; scores: Score[]; testRuns: TestRun[] }) {
  const { state, latestComposite, latestTest } = deriveScenarioState(scenario, scores, testRuns);
  const threshold = scenario.threshold ?? DEFAULT_THRESHOLD;
  const pct = Math.max(0, Math.min(100, latestComposite ?? 0));
  const history = scores.filter((s) => s.scenarioId === scenario.id).sort((a, b) => (a.id < b.id ? -1 : 1));
  return (
    <div className={`scncard card scn-${state}`}>
      <div className="scncard-head">
        <span className="scncard-title">{scenario.title ?? scenario.id}</span>
        <span className={`scnbadge scn-${state}`}>{state}</span>
      </div>
      {scenario.description && <p className="scncard-desc">{scenario.description}</p>}
      <div className="scncard-score">
        <div className="scorebar" role="img" aria-label={`composite ${latestComposite ?? 0} of 100, threshold ${threshold}`}>
          <div className="scorebar-fill" style={{ width: `${pct}%` }} />
          <div className="scorebar-thresh" style={{ left: `${threshold}%` }} />
        </div>
        <span className="scorebar-val tnum">{latestComposite ?? "—"}</span>
      </div>
      <div className="scncard-test dim">
        {latestTest ? <>tests: <span className="tnum">{latestTest.passed ?? 0}</span> passed, <span className="tnum">{latestTest.failed ?? 0}</span> failed</> : "no test run yet"}
      </div>
      {history.length > 1 && (
        <details className="scncard-hist">
          <summary>score history ({history.length})</summary>
          <ul className="scnhist">{history.map((s) => <li key={s.id} className="tnum">{s.composite ?? "—"}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
```

`VisionSection.tsx`:
```tsx
import { ScenarioCard } from "./ScenarioCard";
import type { Goal, Scenario, Score, TestRun } from "../types";

export function VisionSection({ goals, scenarios, scores, testRuns }: { goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[] }) {
  if (scenarios.length === 0) return null;
  // Group scenarios by goal; scenarios whose goal is missing fall under an "Ungrouped" bucket.
  const byGoal = (gid: string) => scenarios.filter((s) => s.goalId === gid);
  const orphaned = scenarios.filter((s) => !goals.some((g) => g.id === s.goalId));
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Vision</h2></div>
      {goals.map((g) => (
        <div key={g.id} className="goalblock">
          <h3 className="goal-title">{g.title ?? g.id}</h3>
          {g.description && <p className="goal-desc dim">{g.description}</p>}
          <div className="scngrid">{byGoal(g.id).map((s) => <ScenarioCard key={s.id} scenario={s} scores={scores} testRuns={testRuns} />)}</div>
        </div>
      ))}
      {orphaned.length > 0 && (
        <div className="goalblock">
          <h3 className="goal-title dim">Ungrouped</h3>
          <div className="scngrid">{orphaned.map((s) => <ScenarioCard key={s.id} scenario={s} scores={scores} testRuns={testRuns} />)}</div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run src/dashboard/components/vision`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/components/ScenariosMetBanner.tsx web/src/dashboard/components/ScenarioCard.tsx web/src/dashboard/components/VisionSection.tsx web/src/dashboard/components/vision.test.tsx
git commit -m "feat(web): scenarios-met banner, scenario card, vision section"
```

---

## Task 4: PlanSection + TaskItem (with legacy fallback)

**Files:**
- Create: `web/src/dashboard/components/TaskItem.tsx`, `web/src/dashboard/components/PlanSection.tsx`
- Modify: `web/src/dashboard/components/vision.test.tsx` (add a legacy-fallback test)

- [ ] **Step 1: Add the failing test** (append to `vision.test.tsx`)

```typescript
import { PlanSection } from "./PlanSection";
import { PhaseItem } from "./PhaseItem";
import { TaskItem } from "./TaskItem";

describe("PlanSection legacy fallback", () => {
  it("renders the Phases header + phases when there are no tasks", () => {
    render(<PlanSection
      phases={[{ id: "build", name: "Build", order: 1, status: "running" }]} tasks={[]}
      renderLegacyPhase={(p) => <PhaseItem phase={p} commits={[{ sha: "abcdef1", message: "init", author: "a" }]} />}
      renderTask={() => null} />);
    expect(screen.getByText("Phases")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("init")).toBeInTheDocument();
  });
  it("renders the phase->task tree when tasks exist", () => {
    render(<PlanSection
      phases={[{ id: "build", name: "Build", order: 1, status: "running" }]}
      tasks={[{ id: "login", phaseId: "build", title: "Login", order: 1, status: "completed", scenarioIds: ["s1"] }]}
      renderLegacyPhase={() => null}
      renderTask={(t) => <TaskItem task={t} commits={[{ sha: "c0ffee1", message: "feat", author: "a" }]} />} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(screen.getByText("feat")).toBeInTheDocument();
  });
});
```

> `PlanSection` is **structural only** — it owns the "no tasks → Phases / tasks → phase-task tree" branching and headers, and delegates the per-row rendering to **render-prop components** (`renderLegacyPhase(phase)` / `renderTask(task)`, each returning a `ReactNode`). This keeps it presentational + testable (tests pass simple elements) while letting `ProjectDetail` (Task 6) pass **container components** that legally call `useCommits`/`useTaskCommits` at their own top level (each rendered element is its own component instance — no rules-of-hooks violation). `PlanSection` is the single source of the tree structure, used by both the page and the tests (no duplicated/dead logic).

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/dashboard/components/vision`
Expected: FAIL — `./PlanSection` not found.

- [ ] **Step 3: Implement `TaskItem.tsx`**

```tsx
import { StatusBadge } from "./StatusBadge";
import { CommitItem } from "./CommitItem";
import type { Task, Commit } from "../types";

export function TaskItem({ task, commits }: { task: Task; commits: Commit[] }) {
  return (
    <div className="taskrow">
      <div className="taskrow-head">
        {task.status && <span className={`sdot s-${task.status}${task.status === "running" ? " is-live" : ""}`} aria-hidden="true" />}
        <span className="taskrow-name">{task.title ?? task.id}</span>
        {task.status && <StatusBadge status={task.status} />}
        {task.scenarioIds && task.scenarioIds.length > 0 && (
          <span className="taskrow-scns dim">{task.scenarioIds.join(", ")}</span>
        )}
        <span className="taskrow-count tnum">{commits.length} commit{commits.length !== 1 ? "s" : ""}</span>
      </div>
      {commits.length > 0 && <ul className="commits">{commits.map((c) => <CommitItem key={c.sha} commit={c} />)}</ul>}
    </div>
  );
}
```

- [ ] **Step 4: Implement `PlanSection.tsx`** (structural; render-prop rows; legacy fallback when no tasks)

```tsx
import type { ReactNode } from "react";
import type { Phase, Task } from "../types";

interface Props {
  phases: Phase[]; tasks: Task[];
  renderLegacyPhase: (phase: Phase) => ReactNode;
  renderTask: (task: Task) => ReactNode;
}

export function PlanSection({ phases, tasks, renderLegacyPhase, renderTask }: Props) {
  // Legacy fallback: no tasks → render today's Phases section (the caller's renderLegacyPhase
  // supplies a PhaseItem backed by phase-scoped commits — unchanged behavior).
  if (tasks.length === 0) {
    return (
      <section>
        <div className="proj-section-head"><h2 className="proj-section-title">Phases</h2></div>
        {phases.length === 0
          ? <div className="empty">No phases yet.</div>
          : <div className="phaselist">{phases.map((p) => <div key={p.id}>{renderLegacyPhase(p)}</div>)}</div>}
      </section>
    );
  }
  // Loop mode: phase → task tree (renderTask supplies a TaskItem backed by task-scoped commits).
  const tasksFor = (phaseId: string) => tasks.filter((t) => t.phaseId === phaseId);
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Tasks</h2></div>
      <div className="planlist">
        {phases.map((p) => (
          <div key={p.id} className="planphase card">
            <div className="planphase-head"><span className="planphase-name">{p.name ?? p.id}</span></div>
            <div className="tasklist">{tasksFor(p.id ?? "").map((t) => <div key={t.id}>{renderTask(t)}</div>)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run to verify both tests pass**

Run: `cd web && npx vitest run src/dashboard/components/vision`
Expected: PASS (banner + ScenarioCard + both PlanSection cases).

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/components/TaskItem.tsx web/src/dashboard/components/PlanSection.tsx web/src/dashboard/components/vision.test.tsx
git commit -m "feat(web): plan section (phase→task tree) with legacy phases fallback"
```

---

## Task 5: RevisionTimeline + DocumentsSection

**Files:**
- Create: `web/src/dashboard/components/RevisionTimeline.tsx`, `web/src/dashboard/components/DocumentsSection.tsx`
- Modify: `web/src/dashboard/components/vision.test.tsx` (add tests)

- [ ] **Step 1: Add failing tests** (append to `vision.test.tsx`)

```typescript
import { RevisionTimeline } from "./RevisionTimeline";
import { DocumentsSection } from "./DocumentsSection";

describe("RevisionTimeline", () => {
  it("renders each revision's reason and changes", () => {
    render(<RevisionTimeline revisions={[{ id: "01A", trigger: { scenarioId: "login", reason: "rough UX" }, changes: [{ op: "add", taskId: "polish" }] }]} />);
    expect(screen.getByText(/rough UX/)).toBeInTheDocument();
    expect(screen.getByText(/add/)).toBeInTheDocument();
    expect(screen.getByText(/polish/)).toBeInTheDocument();
  });
  it("renders nothing when there are no revisions", () => {
    const { container } = render(<RevisionTimeline revisions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DocumentsSection", () => {
  it("links url docs and shows markdown content", () => {
    render(<DocumentsSection documents={[
      { id: "spec", kind: "spec", title: "Spec", format: "url", content: "https://x/s" },
      { id: "vision", kind: "vision", title: "Vision", format: "markdown", content: "# V" },
    ]} />);
    expect(screen.getByRole("link", { name: /Spec/ })).toHaveAttribute("href", "https://x/s");
    expect(screen.getByText("# V")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/dashboard/components/vision`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the components**

`RevisionTimeline.tsx`:
```tsx
import type { Revision } from "../types";

export function RevisionTimeline({ revisions }: { revisions: Revision[] }) {
  if (revisions.length === 0) return null;
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Revisions</h2></div>
      <ul className="revlist">
        {revisions.map((r) => (
          <li key={r.id} className="revrow card">
            <div className="revrow-trigger">
              <span className="revrow-scn mono">{r.trigger?.scenarioId}</span>
              <span className="revrow-reason">{r.trigger?.reason}</span>
            </div>
            <ul className="revchanges">
              {(r.changes ?? []).map((c, i) => (
                <li key={i} className="revchange"><code className="mono">{c.op}</code> <span className="mono">{c.taskId}</span></li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`DocumentsSection.tsx`:
```tsx
import type { DocumentRec } from "../types";

export function DocumentsSection({ documents }: { documents: DocumentRec[] }) {
  if (documents.length === 0) return null;
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Documents</h2></div>
      <div className="doclist">
        {documents.map((d) => (
          <div key={d.id} className="docrow card">
            <div className="docrow-head">
              {/* url docs: the TITLE is the link (its accessible name is the title); markdown: plain title + <pre> body */}
              {d.format === "url"
                ? <a className="docrow-title" href={d.content} target="_blank" rel="noopener">{d.title ?? d.id}</a>
                : <span className="docrow-title">{d.title ?? d.id}</span>}
              <code className="chip">{d.kind}</code>
            </div>
            {d.format === "url"
              ? <span className="docrow-url dim mono">{d.content}</span>
              : <pre className="doc-pre mono">{d.content}</pre>}
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run src/dashboard/components/vision`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/components/RevisionTimeline.tsx web/src/dashboard/components/DocumentsSection.tsx web/src/dashboard/components/vision.test.tsx
git commit -m "feat(web): revision timeline + documents section"
```

---

## Task 6: Compose into ProjectDetail + CSS

**Files:**
- Modify: `web/src/dashboard/ProjectDetail.tsx`
- Modify: `web/src/index.css`

- [ ] **Step 1: Rewrite `ProjectDetail.tsx` to compose the sections**

Subscribe to all the new collections and compose. Keep the `PhaseItemContainer` pattern for legacy commits, and add a `TaskCommits` container that supplies `taskCommitsFor`. Since hooks can't be called inside a callback, supply commits by rendering small container components. Concretely:

```tsx
import { useParams, Link } from "react-router-dom";
import {
  useProject, usePhases, useCommits, useGoals, useScenarios, useTasks,
  useScores, useTestRuns, useRevisions, useDocuments, useTaskCommits,
} from "./hooks";
import { ProjectHeader } from "./components/ProjectHeader";
import { ScenariosMetBanner } from "./components/ScenariosMetBanner";
import { VisionSection } from "./components/VisionSection";
import { PlanSection } from "./components/PlanSection";
import { TaskItem } from "./components/TaskItem";
import { PhaseItem } from "./components/PhaseItem";
import { RevisionTimeline } from "./components/RevisionTimeline";
import { DocumentsSection } from "./components/DocumentsSection";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import { summarize } from "./scenarioState";
import type { Phase, Task } from "./types";

// Small containers so commit hooks are called at component top-level (not in a callback).
function LegacyPhase({ teamId, slug, phase }: { teamId: string; slug: string; phase: Phase }) {
  const { data } = useCommits(teamId, slug, phase.id ?? "");
  return <PhaseItem phase={phase} commits={data} />;
}
function PlanTask({ teamId, slug, task }: { teamId: string; slug: string; task: Task }) {
  const { data } = useTaskCommits(teamId, slug, task.id);
  return <TaskItem task={task} commits={data} />;
}

export function ProjectDetail() {
  const { teamId = "", slug = "" } = useParams();
  const project = useProject(teamId, slug);
  const phases = usePhases(teamId, slug);
  const goals = useGoals(teamId, slug);
  const scenarios = useScenarios(teamId, slug);
  const tasks = useTasks(teamId, slug);
  const scores = useScores(teamId, slug);
  const testRuns = useTestRuns(teamId, slug);
  const revisions = useRevisions(teamId, slug);
  const documents = useDocuments(teamId, slug);

  const hasScenarios = scenarios.data.length > 0;
  const { met, total } = summarize(scenarios.data, scores.data, testRuns.data);

  return (
    <div className="main main--narrow">
      <Link to="/dashboard" className="back">← back to dashboard</Link>
      {project.loading ? <Spinner />
        : project.error ? <ErrorNote message={project.error} />
        : project.data === null ? <EmptyState message="Project not found." />
        : (
          <>
            {project.data && <ProjectHeader project={project.data} />}
            {hasScenarios && <ScenariosMetBanner met={met} total={total} />}
            {hasScenarios && <VisionSection goals={goals.data} scenarios={scenarios.data} scores={scores.data} testRuns={testRuns.data} />}

            {/* Plan: PlanSection branches on tasks; container render-props call the commit hooks legally. */}
            <PlanSection
              phases={phases.data}
              tasks={tasks.data}
              renderLegacyPhase={(p) => <LegacyPhase teamId={teamId} slug={slug} phase={p} />}
              renderTask={(t) => <PlanTask teamId={teamId} slug={slug} task={t} />}
            />

            <RevisionTimeline revisions={revisions.data} />
            <DocumentsSection documents={documents.data} />
          </>
        )}
    </div>
  );
}
```

> NOTE: `PlanSection` owns the structure + the no-tasks/legacy branching (one source of truth, used here and in its tests). `ProjectDetail` passes **container components** (`LegacyPhase`/`PlanTask`) via the render props — each is its own component instance, so `useCommits`/`useTaskCommits` run at that component's top level (rules-of-hooks satisfied). The legacy branch reproduces today's "Phases" header + `PhaseItem` exactly (no regression).

- [ ] **Step 2: Add CSS** (`web/src/index.css`, append)

Add classes used above, styled on the existing espresso/gold palette (reuse existing CSS variables — inspect the top of `index.css` for `--` tokens and match them). Minimum set: `.metbanner`, `.metbanner-num`, `.metbanner-label`, `.metbanner--all`; `.goalblock`, `.goal-title`, `.goal-desc`, `.scngrid`; `.scncard`, `.scncard-head`, `.scncard-title`, `.scnbadge`, `.scn-met`, `.scn-unmet`, `.scncard-desc`, `.scncard-score`, `.scorebar`, `.scorebar-fill`, `.scorebar-thresh`, `.scorebar-val`, `.scncard-test`, `.scncard-hist`, `.scnhist`; `.planlist`, `.planphase`, `.planphase-head`, `.planphase-name`, `.tasklist`, `.taskrow`, `.taskrow-head`, `.taskrow-name`, `.taskrow-scns`, `.taskrow-count`; `.revlist`, `.revrow`, `.revrow-trigger`, `.revrow-scn`, `.revrow-reason`, `.revchanges`, `.revchange`; `.doclist`, `.docrow`, `.docrow-head`, `.docrow-title`, `.docrow-url`. Keep it simple and consistent (cards reuse `.card`; met=gold/green accent, unmet=muted; `.scorebar` a thin track with a filled portion and a threshold tick). Give `.doc-pre` (and any markdown `<pre>`) `white-space: pre-wrap` so long content wraps inside the card instead of overflowing. Exact visual polish is at the implementer's discretion within the existing design language.

- [ ] **Step 3: Type-check + build + full web tests**

Run: `cd web && npm run build && npm test`
Expected: build clean; all web tests pass (scenarioState + vision component tests + the existing `detail.test.tsx` etc.).

- [ ] **Step 4: Commit**

```bash
git add web/src/dashboard/ProjectDetail.tsx web/src/index.css
git commit -m "feat(web): render the vision loop on ProjectDetail (banner, vision, tasks, revisions, docs)"
```

---

## Task 7: Verification

**Files:** none (verification only).

- [ ] **Step 1: Full web test suite**

Run: `cd web && npm test`
Expected: PASS — `scenarioState.test.ts`, `vision.test.tsx`, and all pre-existing dashboard tests (`detail.test.tsx`, `shared.test.tsx`, `team.test.tsx`, `screens.test.tsx`) green.

- [ ] **Step 2: Build clean**

Run: `cd web && npm run build`
Expected: `tsc -b` 0 errors + `vite build` succeeds.

- [ ] **Step 3: Functions suite unaffected (sanity — no backend change expected)**

Run: `cd functions && npm test`
Expected: green, unchanged from the functions baseline (this sub-project changed nothing under `functions/`; treat a fully-green run as the criterion rather than a literal count).

- [ ] **Step 4: Confirm success criteria by inspection**

- Loop project (scenarios+tasks) → banner + Vision (goals→scenario cards with met/unmet, composite bar, latest test, history) + Tasks tree (task-scoped commits) + Revisions + Documents.
- `scenario.state` derivation verified by `scenarioState.test.ts` (threshold boundary, latest-by-id, no-score/no-test, default 80).
- Legacy project (no tasks) → unchanged "Phases" + phase-commits.
- No change under `functions/`, `firestore.rules`, or `cli/`.

- [ ] **Step 5: Final commit (if any verification fixes)**

```bash
git add -A -- web
git commit -m "chore: vision tracking UI verification (web build + tests green)"
```

---

## Notes for the executor

- **Only `scenarioState.ts` is pure TDD logic.** Components are render-tested with props (no Firestore). Hooks are thin `onSnapshot` wrappers — not unit-tested, mirroring the existing `usePhases`/`useCommits`.
- **Do not break legacy projects.** The no-tasks branch must reproduce today's Phases section exactly (header + `PhaseItem` + `useCommits`). The existing `detail.test.tsx` for `PhaseItem` must stay green.
- **Latest-by-id, not by timestamp** — always select the lexically-greatest document id for "latest" score/test (events are ULID-keyed).
- **No new dependencies** — no charting or markdown libraries; the score history is a CSS/SVG-free simple list/bar, documents render as link or `<pre>`.
- **Stay inside `web/`** — this sub-project touches no API, rules, or CLI.
- Do NOT `git add -A` broadly; add named `web/...` paths (pre-existing untracked `.DS_Store`/`prototype/`).
