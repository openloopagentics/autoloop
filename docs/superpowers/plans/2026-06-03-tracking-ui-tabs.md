# Tracking UI: tabs, loops, bugs, summaries, rollups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the React project-detail page into Dashboard/Vision/Loops/Bugs tabs, make the run-data views loop-aware (per-loop scoping + synthesized `main`), add dashboard rollups, render test-run summaries and a bugs view, and mark only the loop's current task as live.

**Architecture:** Read-only, mirroring v2.1's write-side base-path pattern. Pure helpers (`loopView.ts`) compute the selectable-loop list, default selection, phase progress, and Firestore path segments; the existing `Result<T>` `onSnapshot` hooks gain an optional `loopId`; new presentational components are tested with props (hooks stay thin, per the existing pattern); `ProjectDetail` becomes a thin orchestrator over tab containers.

**Tech Stack:** React + TypeScript, react-router-dom, Firebase Firestore (`onSnapshot`), Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-03-tracking-ui-tabs-design.md`

**Conventions (read before starting):**
- All web commands run from `web/`. Full test suite: `cd web && npm test` (vitest run, jsdom). Single file: `cd web && npx vitest run src/dashboard/<file>.test.tsx`. Build/typecheck: `cd web && npm run build` (`tsc -b && vite build`).
- Component tests render presentational components with explicit props (see `src/dashboard/components/detail.test.tsx`) — they do NOT touch Firestore. Hooks (thin `onSnapshot` wrappers) are NOT unit-tested, matching the existing codebase; they're covered by `npm run build` (types) + manual smoke.
- Match existing style: `Result<T>` hooks, `card`/`dim`/`tnum`/`proj-section-*` CSS classes, `StatusBadge` for the 7-state status.
- Commit messages end with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- This is SP2; the SP1 contract (`bug` entity + `testRun.summary`) is already on this branch.

---

### Task 1: Pure helpers — `loopView.ts` + `isTerminalStatus`

**Files:**
- Create: `web/src/dashboard/loopView.ts`
- Modify: `web/src/dashboard/status.ts` (add `isTerminalStatus`)
- Create: `web/src/dashboard/loopView.test.ts`

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/loopView.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { basePath, buildLoopList, defaultSelectedLoop, phaseProgress, loopIsRunning } from "./loopView";
import type { Loop, Phase, Project } from "./types";

describe("basePath", () => {
  it("is project-direct without a loopId", () => {
    expect(basePath("t", "web")).toEqual(["teams", "t", "projects", "web"]);
  });
  it("inserts loops/<id> with a loopId", () => {
    expect(basePath("t", "web", "l1")).toEqual(["teams", "t", "projects", "web", "loops", "l1"]);
  });
});

describe("buildLoopList", () => {
  const project = { slug: "web", status: "running", currentPhaseId: "p1", currentTaskId: "t1" } as Project;
  const loops: Loop[] = [
    { id: "l2", goal: "B", order: 2, status: "running", currentTaskId: "t9" },
    { id: "l1", goal: "A", order: 1, status: "completed" },
  ];
  it("sorts explicit loops by order then id and adds no main when no legacy data", () => {
    const list = buildLoopList(loops, project, false);
    expect(list.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(list.some((l) => l.isMain)).toBe(false);
  });
  it("appends a synthesized main (with project fields) when legacy data exists", () => {
    const list = buildLoopList(loops, project, true);
    expect(list[list.length - 1]).toMatchObject({ id: "main", isMain: true, status: "running", currentTaskId: "t1" });
  });
  it("main-only when there are no explicit loops", () => {
    const list = buildLoopList([], project, true);
    expect(list).toHaveLength(1);
    expect(list[0].isMain).toBe(true);
  });
});

describe("defaultSelectedLoop", () => {
  const list = buildLoopList(
    [{ id: "l1", order: 1, status: "completed" }, { id: "l2", order: 2, status: "running" }],
    { slug: "web", status: "running", currentPhaseId: "p" } as Project, true);
  it("prefers a valid currentLoopId", () => {
    expect(defaultSelectedLoop(list, "l1")).toBe("l1");
  });
  it("falls back to the most-recent explicit loop (highest order)", () => {
    expect(defaultSelectedLoop(list, null)).toBe("l2");
  });
  it("falls back to main when only main exists", () => {
    const mainOnly = buildLoopList([], { slug: "web", currentPhaseId: "p" } as Project, true);
    expect(defaultSelectedLoop(mainOnly, null)).toBe("main");
  });
  it("returns '' for an empty list", () => {
    expect(defaultSelectedLoop([], null)).toBe("");
  });
});

describe("phaseProgress", () => {
  const phases: Phase[] = [
    { id: "p1", status: "completed" }, { id: "p2", status: "failed" },
    { id: "p3", status: "running" }, { id: "p4", status: "queued" }, { id: "p5", status: "cancelled" },
  ];
  it("counts terminal phases (completed/failed/cancelled) as done", () => {
    expect(phaseProgress(phases)).toEqual({ done: 3, total: 5 });
  });
  it("handles no phases", () => {
    expect(phaseProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe("loopIsRunning", () => {
  it("is true only for status running", () => {
    expect(loopIsRunning({ status: "running" })).toBe(true);
    expect(loopIsRunning({ status: "completed" })).toBe(false);
    expect(loopIsRunning({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/dashboard/loopView.test.ts`
Expected: FAIL (module `./loopView` not found; `isTerminalStatus` missing).

- [ ] **Step 3: Implement `isTerminalStatus` in `status.ts`**

Append to `web/src/dashboard/status.ts`:

```ts
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}
```

- [ ] **Step 4: Implement `loopView.ts`**

```ts
import type { Loop, Phase, Project } from "./types";
import { isTerminalStatus } from "./status";

export const MAIN_ID = "main";

export interface SelectableLoop {
  id: string; isMain: boolean;
  goal?: string; name?: string; status?: string; order?: number;
  currentPhaseId?: string | null; currentTaskId?: string | null;
}

/** Firestore path segments for a (loop-scoped or project-direct) collection root. */
export function basePath(teamId: string, slug: string, loopId?: string): string[] {
  const base = ["teams", teamId, "projects", slug];
  return loopId ? [...base, "loops", loopId] : base;
}

/** Explicit loops (sorted by order then id) + a synthesized `main` when the project has legacy
 *  project-direct data. `main` carries the PROJECT doc's status/currentPhaseId/currentTaskId. */
export function buildLoopList(loops: Loop[], project: Project | null | undefined, hasProjectDirectData: boolean): SelectableLoop[] {
  const list: SelectableLoop[] = [...loops]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
    .map((l) => ({
      id: l.id, isMain: false, goal: l.goal, name: l.name, status: l.status, order: l.order,
      currentPhaseId: l.currentPhaseId, currentTaskId: l.currentTaskId,
    }));
  if (hasProjectDirectData) {
    list.push({
      id: MAIN_ID, isMain: true, name: "main", status: project?.status,
      currentPhaseId: project?.currentPhaseId, currentTaskId: project?.currentTaskId,
    });
  }
  return list;
}

/** Default selection: a valid currentLoopId → else the most-recent explicit loop (highest order)
 *  → else main → else "" (empty list). */
export function defaultSelectedLoop(list: SelectableLoop[], currentLoopId?: string | null): string {
  if (list.length === 0) return "";
  if (currentLoopId && list.some((l) => l.id === currentLoopId)) return currentLoopId;
  const explicit = list.filter((l) => !l.isMain);
  if (explicit.length > 0) return explicit[explicit.length - 1].id; // list is asc by order
  return list[list.length - 1].id; // main
}

/** Phase progress: done = terminal-status phases (completed/failed/cancelled). */
export function phaseProgress(phases: Phase[]): { done: number; total: number } {
  let done = 0;
  for (const p of phases) if (p.status && isTerminalStatus(p.status)) done++;
  return { done, total: phases.length };
}

export function loopIsRunning(loop: { status?: string }): boolean {
  return loop.status === "running";
}

/** Hook arg for a selectable loop: undefined for main (project-direct), else its id. */
export function loopArgFor(loop: SelectableLoop | undefined): string | undefined {
  return !loop || loop.isMain ? undefined : loop.id;
}
```

> Note: `Loop`, `Bug`, and the `Project`/`TestRun` extensions are added in Task 2, but `loopView.ts` only needs `Loop`/`Phase`/`Project`. `Loop` does not exist yet — add a minimal `Loop` interface to `types.ts` NOW as part of this task (the full set lands in Task 2; adding `Loop` early keeps this task self-compiling). Add to `web/src/dashboard/types.ts`:
> ```ts
> export interface Loop {
>   id: string; goal?: string; name?: string; order?: number; status?: string;
>   startedAt?: unknown; endedAt?: unknown;
>   currentPhaseId?: string | null; currentTaskId?: string | null;
> }
> ```
> And extend `Project` with `currentTaskId?: string | null;` (it already has `currentPhaseId`).

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx vitest run src/dashboard/loopView.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/loopView.ts web/src/dashboard/loopView.test.ts web/src/dashboard/status.ts web/src/dashboard/types.ts
git commit -m "feat(web): loopView pure helpers + isTerminalStatus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Types + loop-aware hooks

**Files:**
- Modify: `web/src/dashboard/types.ts` (add `Bug`; `TestRun.summary`; `Project.currentLoopId`)
- Modify: `web/src/dashboard/hooks.ts` (loopId param via `basePath`; add `useLoops`, `useBugs`)

No new unit tests (hooks are thin wrappers, per the existing pattern); the gate is `npm run build` clean.

- [ ] **Step 1: Finish the type additions**

In `web/src/dashboard/types.ts`:
- Add to `Project`: `currentLoopId?: string | null;` (and confirm `currentTaskId?: string | null;` from Task 1 is present).
- Add to `TestRun`: `summary?: string;`
- Add:
```ts
export interface Bug {
  id: string; title?: string; description?: string; scenarioId?: string; taskId?: string;
  severity?: "low" | "medium" | "high"; status?: "open" | "fixed";
  createdAt?: unknown; updatedAt?: unknown; fixedAt?: unknown;
}
```

- [ ] **Step 2: Make the run-data hooks loop-aware**

In `web/src/dashboard/hooks.ts`:
- Add the import: `import { basePath } from "./loopView";` and `import type { ..., Loop, Bug } from "./types";` (extend the existing type import).
- For each of `usePhases`, `useTasks`, `useScores`, `useTestRuns`, `useRevisions`, `useTaskCommits`, `useCommits`: add a trailing optional `loopId?: string` param, build the collection root from `basePath(teamId, slug, loopId)`, and add `loopId` to the `useEffect` dependency array. Example (`usePhases`):

```ts
export function usePhases(teamId: string, slug: string, loopId?: string): Result<Phase[]> {
  const [data, setData] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, ...basePath(teamId, slug, loopId), "phases"), orderBy("order"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Phase[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug, loopId]);
  return { data, loading, error };
}
```

Apply the same transformation to the others. For `useCommits(teamId, slug, phaseId, loopId?)` and `useTaskCommits(teamId, slug, taskId, loopId?)` the loop segment goes BEFORE `phases`/`tasks`: `collection(db, ...basePath(teamId, slug, loopId), "phases", phaseId, "commits")` and `..., "tasks", taskId, "commits"` — and add `loopId` to their dep arrays. (`useGoals`, `useScenarios`, `useDocuments`, `useProject` stay project-level — do NOT add `loopId`.)

- [ ] **Step 3: Add `useLoops` and `useBugs`**

```ts
export function useLoops(teamId: string, slug: string): Result<Loop[]> {
  const [data, setData] = useState<Loop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "loops"), orderBy("order"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Loop[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function useBugs(teamId: string, slug: string, loopId?: string): Result<Bug[]> {
  const [data, setData] = useState<Bug[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, ...basePath(teamId, slug, loopId), "bugs"), orderBy(documentId()));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Bug[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug, loopId]);
  return { data, loading, error };
}
```

- [ ] **Step 4: Build to verify types**

Run: `cd web && npm run build`
Expected: clean. (If `ProjectDetail.tsx` still calls the old hook signatures, that's fine — the added params are optional, so existing calls compile. ProjectDetail is rewritten in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/types.ts web/src/dashboard/hooks.ts
git commit -m "feat(web): loop-aware run-data hooks + useLoops/useBugs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Only-current-task-is-live (`TaskItem` + `PlanSection`)

**Files:**
- Modify: `web/src/dashboard/components/TaskItem.tsx`
- Modify: `web/src/dashboard/components/PlanSection.tsx`
- Create: `web/src/dashboard/components/plan.test.tsx`

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/components/plan.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TaskItem } from "./TaskItem";

describe("TaskItem live rule", () => {
  it("marks is-live ONLY when isCurrent, regardless of stored status", () => {
    const { container, rerender } = render(<TaskItem task={{ id: "t1", title: "A", status: "running" }} commits={[]} isCurrent />);
    expect(container.querySelector(".sdot.is-live")).not.toBeNull();
    // a non-current task whose stored status is "running" must NOT be live
    rerender(<TaskItem task={{ id: "t2", title: "B", status: "running" }} commits={[]} isCurrent={false} />);
    expect(container.querySelector(".sdot.is-live")).toBeNull();
    // the status dot still reflects stored status
    expect(container.querySelector(".sdot.s-running")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/dashboard/components/plan.test.tsx`
Expected: FAIL (TaskItem has no `isCurrent` prop; the second assertion fails because the old code marks any running task live).

- [ ] **Step 3: Implement `TaskItem` change**

Replace the status-dot line in `web/src/dashboard/components/TaskItem.tsx`. New signature + dot:

```tsx
export function TaskItem({ task, commits, isCurrent = false }: { task: Task; commits: Commit[]; isCurrent?: boolean }) {
  return (
    <div className="taskrow">
      <div className="taskrow-head">
        {task.status && <span className={`sdot s-${task.status}${isCurrent ? " is-live" : ""}`} aria-hidden="true" />}
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

- [ ] **Step 4: Implement `PlanSection` change**

In `web/src/dashboard/components/PlanSection.tsx`: add `currentTaskId?: string | null;` to `Props`, change `renderTask` to `(task: Task, isCurrent: boolean) => ReactNode`, and pass the flag:

```tsx
interface Props {
  phases: Phase[];
  tasks: Task[];
  currentTaskId?: string | null;
  renderLegacyPhase: (phase: Phase) => ReactNode;
  renderTask: (task: Task, isCurrent: boolean) => ReactNode;
}
```
and in the task map:
```tsx
<div className="tasklist">{tasksFor(p.id ?? "").map((t) => <div key={t.id}>{renderTask(t, t.id === currentTaskId)}</div>)}</div>
```

> The current `ProjectDetail.tsx` passes `renderTask={(t) => ...}` (one arg) — that still compiles (extra param ignored) until Task 8 rewrites it, but to keep the build clean update the existing `PlanTask` call site in `ProjectDetail.tsx` to accept the second arg now: `renderTask={(t, isCurrent) => <PlanTask teamId={teamId} slug={slug} task={t} isCurrent={isCurrent} />}` and add `isCurrent` to the local `PlanTask` container (pass it to `<TaskItem ... isCurrent={isCurrent} />`). (ProjectDetail is fully rewritten in Task 8; this just keeps it compiling + correct in between.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx vitest run src/dashboard/components/plan.test.tsx`
Expected: PASS.

- [ ] **Step 6: Build to confirm no breakage**

Run: `cd web && npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/dashboard/components/TaskItem.tsx web/src/dashboard/components/PlanSection.tsx web/src/dashboard/components/plan.test.tsx web/src/dashboard/ProjectDetail.tsx
git commit -m "feat(web): only the loop's current task renders as live

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tab bar + loop selector

**Files:**
- Create: `web/src/dashboard/components/Tabs.tsx`
- Create: `web/src/dashboard/components/LoopSelector.tsx`
- Create: `web/src/dashboard/components/shell.test.tsx`

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/components/shell.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";
import { LoopSelector } from "./LoopSelector";
import type { SelectableLoop } from "../loopView";

describe("Tabs", () => {
  it("renders the four tabs, marks the active one, and fires onChange", () => {
    const onChange = vi.fn();
    render(<Tabs active="dashboard" onChange={onChange} />);
    for (const t of ["Dashboard", "Vision", "Loops", "Bugs"]) expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Loops" }));
    expect(onChange).toHaveBeenCalledWith("loops");
  });
});

describe("LoopSelector", () => {
  const loops: SelectableLoop[] = [
    { id: "l1", isMain: false, goal: "Search", status: "completed" },
    { id: "l2", isMain: false, name: "Payments", status: "running" },
    { id: "main", isMain: true, name: "main", status: "running" },
  ];
  it("renders an option per loop (main labeled legacy) and fires onChange", () => {
    const onChange = vi.fn();
    render(<LoopSelector loops={loops} selectedId="l2" onChange={onChange} />);
    expect(screen.getByText(/main \(legacy\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "l1" } });
    expect(onChange).toHaveBeenCalledWith("l1");
  });
  it("renders nothing for a single loop", () => {
    const { container } = render(<LoopSelector loops={[loops[0]]} selectedId="l1" onChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/dashboard/components/shell.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `Tabs.tsx`**

```tsx
export type TabKey = "dashboard" | "vision" | "loops" | "bugs";

const TABS: { key: TabKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "vision", label: "Vision" },
  { key: "loops", label: "Loops" },
  { key: "bugs", label: "Bugs" },
];

export function Tabs({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <div className="tabbar" role="tablist">
      {TABS.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key}
          className={`tab${active === t.key ? " tab--active" : ""}`} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement `LoopSelector.tsx`**

```tsx
import type { SelectableLoop } from "../loopView";

function labelFor(l: SelectableLoop): string {
  return l.isMain ? "main (legacy)" : (l.name ?? l.goal ?? l.id);
}

export function LoopSelector({ loops, selectedId, onChange }: { loops: SelectableLoop[]; selectedId: string; onChange: (id: string) => void }) {
  if (loops.length <= 1) return null;
  return (
    <label className="loopsel">
      <span className="loopsel-label dim">Loop</span>
      <select value={selectedId} onChange={(e) => onChange(e.target.value)}>
        {loops.map((l) => (
          <option key={l.id} value={l.id}>{labelFor(l)}{l.status ? ` — ${l.status}` : ""}</option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx vitest run src/dashboard/components/shell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/components/Tabs.tsx web/src/dashboard/components/LoopSelector.tsx web/src/dashboard/components/shell.test.tsx
git commit -m "feat(web): tab bar + loop selector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Dashboard pieces — `RollupStrip` + `LoopSnapshot`

**Files:**
- Create: `web/src/dashboard/components/RollupStrip.tsx`
- Create: `web/src/dashboard/components/LoopSnapshot.tsx`
- Create: `web/src/dashboard/components/dashboard.test.tsx`

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/components/dashboard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RollupStrip } from "./RollupStrip";
import { LoopSnapshot } from "./LoopSnapshot";
import type { SelectableLoop } from "../loopView";

const loops: SelectableLoop[] = [
  { id: "l1", isMain: false, status: "completed" },
  { id: "l2", isMain: false, status: "running" },
  { id: "l3", isMain: false, status: "running" },
];

describe("RollupStrip", () => {
  it("shows total loops and running count", () => {
    render(<RollupStrip loops={loops} status="running" />);
    expect(screen.getByText("3")).toBeInTheDocument();   // total
    expect(screen.getByText("2")).toBeInTheDocument();   // running
  });
});

describe("LoopSnapshot", () => {
  const loop: SelectableLoop = { id: "l2", isMain: false, name: "Payments", status: "running", currentTaskId: "t2" };
  const scenarios = [{ id: "s1", threshold: 80 }, { id: "s2", threshold: 80 }] as any;
  const scores = [{ id: "01A", scenarioId: "s1", composite: 90 }] as any;
  const testRuns = [{ id: "01B", scenarioId: "s1", passed: 1, failed: 0 }] as any;
  const phases = [{ id: "p1", status: "completed" }, { id: "p2", status: "running" }] as any;
  const tasks = [{ id: "t2", title: "Wire Stripe", status: "running" }] as any;
  it("shows phases done/total, N/M met, and the in-progress task", () => {
    const { container } = render(<LoopSnapshot loop={loop} phases={phases} tasks={tasks} scenarios={scenarios} scores={scores} testRuns={testRuns} />);
    // both metrics are "1/2" here, so query by class (not getByText, which would throw on the duplicate)
    expect(container.querySelector(".snapshot-phases")?.textContent).toContain("1/2"); // phases done/total
    expect(container.querySelector(".snapshot-met")?.textContent).toContain("1/2");    // N/M met
    expect(screen.getByText(/Wire Stripe/)).toBeInTheDocument();                        // in-progress task
  });
  it("says no active task when currentTaskId is absent", () => {
    render(<LoopSnapshot loop={{ id: "l1", isMain: false }} phases={[]} tasks={[]} scenarios={[]} scores={[]} testRuns={[]} />);
    expect(screen.getByText(/no active task/i)).toBeInTheDocument();
  });
});
```

> Note: the two metrics share the value "1/2" in this fixture, so the test queries by the distinct CSS classes `snapshot-phases`/`snapshot-met` (added in the LoopSnapshot impl below) rather than `getByText`, which would throw on the duplicate.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/dashboard/components/dashboard.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `RollupStrip.tsx`**

```tsx
import type { SelectableLoop } from "../loopView";
import { loopIsRunning } from "../loopView";
import { StatusBadge } from "./StatusBadge";

export function RollupStrip({ loops, status }: { loops: SelectableLoop[]; status?: string }) {
  const running = loops.filter(loopIsRunning).length;
  return (
    <div className="rollup card">
      <div className="rollup-item"><span className="rollup-num tnum">{loops.length}</span><span className="rollup-label">loops</span></div>
      <div className="rollup-item"><span className="rollup-num tnum">{running}</span><span className="rollup-label">running</span></div>
      {status && <div className="rollup-item rollup-status"><StatusBadge status={status} /></div>}
    </div>
  );
}
```

- [ ] **Step 4: Implement `LoopSnapshot.tsx`**

```tsx
import type { Phase, Scenario, Score, TestRun, Task } from "../types";
import type { SelectableLoop } from "../loopView";
import { phaseProgress } from "../loopView";
import { summarize } from "../scenarioState";
import { StatusBadge } from "./StatusBadge";

export function LoopSnapshot({ loop, phases, tasks, scenarios, scores, testRuns }: {
  loop: SelectableLoop; phases: Phase[]; tasks: Task[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[];
}) {
  const prog = phaseProgress(phases);
  const met = summarize(scenarios, scores, testRuns);
  const currentTask = tasks.find((t) => t.id === loop.currentTaskId) ?? null;
  return (
    <section className="snapshot card">
      <div className="snapshot-head">
        <span className="snapshot-name">{loop.name ?? loop.goal ?? loop.id}</span>
        {loop.status && <StatusBadge status={loop.status} />}
      </div>
      <div className="snapshot-metrics">
        <span className="snapshot-metric snapshot-phases tnum">{prog.done}/{prog.total}<span className="dim"> phases</span></span>
        <span className="snapshot-metric snapshot-met tnum">{met.met}/{met.total}<span className="dim"> scenarios met</span></span>
      </div>
      <div className="snapshot-current">
        {currentTask
          ? <><span className="sdot s-running is-live" aria-hidden="true" /><span>In progress: {currentTask.title ?? currentTask.id}</span></>
          : <span className="dim">No active task</span>}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx vitest run src/dashboard/components/dashboard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/components/RollupStrip.tsx web/src/dashboard/components/LoopSnapshot.tsx web/src/dashboard/components/dashboard.test.tsx
git commit -m "feat(web): dashboard rollup strip + loop snapshot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Loops pieces — `TestRunsSection`, `LoopRow`, `LoopList`, `LoopDetail`

**Files:**
- Create: `web/src/dashboard/components/TestRunsSection.tsx`
- Create: `web/src/dashboard/components/LoopRow.tsx`
- Create: `web/src/dashboard/components/LoopList.tsx`
- Create: `web/src/dashboard/components/LoopDetail.tsx`
- Create: `web/src/dashboard/components/loops.test.tsx`

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/components/loops.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestRunsSection } from "./TestRunsSection";
import { LoopRow } from "./LoopRow";
import type { SelectableLoop } from "../loopView";

describe("TestRunsSection", () => {
  it("renders counts and a summary when present, nothing when empty", () => {
    const { container, rerender } = render(<TestRunsSection testRuns={[{ id: "01A", passed: 8, failed: 1, summary: "exercised login" }]} />);
    expect(screen.getByText(/8 passed/)).toBeInTheDocument();
    expect(screen.getByText(/exercised login/)).toBeInTheDocument();
    rerender(<TestRunsSection testRuns={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("LoopRow", () => {
  const loop: SelectableLoop = { id: "l2", isMain: false, name: "Payments", status: "running" };
  it("shows name, marks running, shows progress + met, fires onSelect", () => {
    const onSelect = vi.fn();
    render(<LoopRow loop={loop} selected={false} progress={{ done: 2, total: 5 }} met={{ met: 1, total: 3 }} onSelect={onSelect} />);
    expect(screen.getByText("Payments")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument(); // StatusBadge text
    expect(screen.getByText(/2\/5/)).toBeInTheDocument();
    expect(screen.getByText(/1\/3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("l2");
  });
});
```

> `LoopList` and `LoopDetail` wire hooks (`usePhases(loopId)` etc.) per loop, so they're integration components not unit-tested here (same rationale as ProjectDetail). Their correctness is covered by `npm run build` + the Task 9 smoke. Test only the presentational `LoopRow`/`TestRunsSection`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/dashboard/components/loops.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `TestRunsSection.tsx`**

```tsx
import type { TestRun } from "../types";

export function TestRunsSection({ testRuns }: { testRuns: TestRun[] }) {
  if (testRuns.length === 0) return null;
  const sorted = [...testRuns].sort((a, b) => (a.id < b.id ? 1 : -1)); // latest (highest id) first
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Test runs</h2></div>
      <ul className="testruns">
        {sorted.map((r) => (
          <li key={r.id} className="testrun card">
            <div className="testrun-head">
              <span className="testrun-counts tnum">{r.passed ?? 0} passed · {r.failed ?? 0} failed</span>
              {r.scenarioId && <span className="testrun-scn dim">{r.scenarioId}</span>}
            </div>
            {r.summary && <pre className="testrun-summary">{r.summary}</pre>}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Implement `LoopRow.tsx`**

```tsx
import type { SelectableLoop } from "../loopView";
import { StatusBadge } from "./StatusBadge";

export function LoopRow({ loop, selected, progress, met, onSelect }: {
  loop: SelectableLoop; selected: boolean;
  progress: { done: number; total: number }; met: { met: number; total: number };
  onSelect: (id: string) => void;
}) {
  return (
    <button type="button" className={`looprow card${selected ? " looprow--sel" : ""}`} aria-pressed={selected} onClick={() => onSelect(loop.id)}>
      <span className="looprow-name">{loop.isMain ? "main (legacy)" : (loop.name ?? loop.goal ?? loop.id)}</span>
      {loop.status && <StatusBadge status={loop.status} />}
      <span className="looprow-prog tnum">{progress.done}/{progress.total} phases</span>
      <span className="looprow-met tnum">{met.met}/{met.total} met</span>
    </button>
  );
}
```

- [ ] **Step 5: Implement `LoopList.tsx`** (per-loop container fetches that loop's summary data)

```tsx
import { usePhases, useScores, useTestRuns } from "../hooks";
import { phaseProgress, loopArgFor, type SelectableLoop } from "../loopView";
import { summarize } from "../scenarioState";
import { LoopRow } from "./LoopRow";
import type { Scenario } from "../types";

function LoopRowContainer({ teamId, slug, loop, scenarios, selected, onSelect }: {
  teamId: string; slug: string; loop: SelectableLoop; scenarios: Scenario[]; selected: boolean; onSelect: (id: string) => void;
}) {
  const arg = loopArgFor(loop);
  const phases = usePhases(teamId, slug, arg);
  const scores = useScores(teamId, slug, arg);
  const testRuns = useTestRuns(teamId, slug, arg);
  return (
    <LoopRow loop={loop} selected={selected}
      progress={phaseProgress(phases.data)}
      met={summarize(scenarios, scores.data, testRuns.data)}
      onSelect={onSelect} />
  );
}

export function LoopList({ teamId, slug, loops, scenarios, selectedId, onSelect }: {
  teamId: string; slug: string; loops: SelectableLoop[]; scenarios: Scenario[]; selectedId: string; onSelect: (id: string) => void;
}) {
  if (loops.length === 0) return <div className="empty">No loops yet.</div>;
  return (
    <div className="looplist">
      {loops.map((l) => (
        <LoopRowContainer key={l.id} teamId={teamId} slug={slug} loop={l} scenarios={scenarios} selected={l.id === selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Implement `LoopDetail.tsx`** (selected loop's tree + test runs + revisions; receives already-fetched data as props)

```tsx
import type { ReactNode } from "react";
import type { Phase, Task, TestRun, Revision } from "../types";
import { PlanSection } from "./PlanSection";
import { TestRunsSection } from "./TestRunsSection";
import { RevisionTimeline } from "./RevisionTimeline";

export function LoopDetail({ phases, tasks, testRuns, revisions, currentTaskId, renderLegacyPhase, renderTask }: {
  phases: Phase[]; tasks: Task[]; testRuns: TestRun[]; revisions: Revision[]; currentTaskId?: string | null;
  renderLegacyPhase: (phase: Phase) => ReactNode; renderTask: (task: Task, isCurrent: boolean) => ReactNode;
}) {
  return (
    <>
      <PlanSection phases={phases} tasks={tasks} currentTaskId={currentTaskId} renderLegacyPhase={renderLegacyPhase} renderTask={renderTask} />
      <TestRunsSection testRuns={testRuns} />
      <RevisionTimeline revisions={revisions} />
    </>
  );
}
```

> Check `RevisionTimeline`'s prop name by reading `web/src/dashboard/components/RevisionTimeline.tsx` — it takes `revisions`. Confirm before wiring.

- [ ] **Step 7: Run to verify it passes + build**

Run: `cd web && npx vitest run src/dashboard/components/loops.test.tsx && npm run build`
Expected: tests PASS; build clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/dashboard/components/TestRunsSection.tsx web/src/dashboard/components/LoopRow.tsx web/src/dashboard/components/LoopList.tsx web/src/dashboard/components/LoopDetail.tsx web/src/dashboard/components/loops.test.tsx
git commit -m "feat(web): loops list + detail + test-run summaries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Bugs view — `BugItem` + `BugsList`

**Files:**
- Create: `web/src/dashboard/components/BugItem.tsx`
- Create: `web/src/dashboard/components/BugsList.tsx`
- Create: `web/src/dashboard/components/bugs.test.tsx`

- [ ] **Step 1: Write the failing tests**

`web/src/dashboard/components/bugs.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BugsList } from "./BugsList";
import type { Bug } from "../types";

const bugs: Bug[] = [
  { id: "b1", title: "Fixed one", status: "fixed", severity: "low" },
  { id: "b2", title: "Open high", status: "open", severity: "high" },
];

describe("BugsList", () => {
  it("renders open before fixed and shows severity + status", () => {
    const { container } = render(<BugsList bugs={bugs} />);
    const titles = Array.from(container.querySelectorAll(".bugrow-title")).map((n) => n.textContent);
    expect(titles).toEqual(["Open high", "Fixed one"]); // open first
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("fixed")).toBeInTheDocument();
  });
  it("shows an empty state when there are no bugs", () => {
    render(<BugsList bugs={[]} />);
    expect(screen.getByText(/no bugs/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/dashboard/components/bugs.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `BugItem.tsx`**

```tsx
import type { Bug } from "../types";

export function BugItem({ bug }: { bug: Bug }) {
  const status = bug.status ?? "open";
  return (
    <div className={`bugrow card bug--${status}`}>
      <div className="bugrow-head">
        <span className="bugrow-title">{bug.title ?? bug.id}</span>
        {bug.severity && <span className={`sev sev--${bug.severity}`}>{bug.severity}</span>}
        <span className={`bugstatus bugstatus--${status}`}>{status}</span>
      </div>
      {bug.description && <p className="bugrow-desc dim">{bug.description}</p>}
      {(bug.scenarioId || bug.taskId) && (
        <div className="bugrow-refs dim">
          {bug.scenarioId && <span>scenario {bug.scenarioId}</span>}
          {bug.taskId && <span>task {bug.taskId}</span>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `BugsList.tsx`**

```tsx
import type { Bug } from "../types";
import { BugItem } from "./BugItem";

export function BugsList({ bugs }: { bugs: Bug[] }) {
  if (bugs.length === 0) return <div className="empty">No bugs reported.</div>;
  const open = bugs.filter((b) => b.status !== "fixed");
  const fixed = bugs.filter((b) => b.status === "fixed");
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Bugs</h2></div>
      <div className="buglist">{[...open, ...fixed].map((b) => <BugItem key={b.id} bug={b} />)}</div>
    </section>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx vitest run src/dashboard/components/bugs.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/dashboard/components/BugItem.tsx web/src/dashboard/components/BugsList.tsx web/src/dashboard/components/bugs.test.tsx
git commit -m "feat(web): bugs list view (open-first, severity/status)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Tab containers + `ProjectDetail` orchestration

**Files:**
- Create: `web/src/dashboard/tabs/DashboardTab.tsx`, `VisionTab.tsx`, `LoopsTab.tsx`, `BugsTab.tsx`
- Rewrite: `web/src/dashboard/ProjectDetail.tsx`

This is the integration task — wiring the hooks, selection state, and tabs. No new unit tests (integration; covered by build + existing `detail.test.tsx` + Task 9 smoke). Keep each tab container thin.

- [ ] **Step 1: Implement the tab containers**

`web/src/dashboard/tabs/DashboardTab.tsx`:

```tsx
import { RollupStrip } from "../components/RollupStrip";
import { LoopSnapshot } from "../components/LoopSnapshot";
import type { SelectableLoop } from "../loopView";
import type { Phase, Task, Scenario, Score, TestRun } from "../types";

export function DashboardTab({ loops, selected, status, phases, tasks, scenarios, scores, testRuns }: {
  loops: SelectableLoop[]; selected: SelectableLoop | undefined; status?: string;
  phases: Phase[]; tasks: Task[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[];
}) {
  return (
    <>
      <RollupStrip loops={loops} status={status} />
      {selected && <LoopSnapshot loop={selected} phases={phases} tasks={tasks} scenarios={scenarios} scores={scores} testRuns={testRuns} />}
    </>
  );
}
```

`web/src/dashboard/tabs/VisionTab.tsx` (project-level vision; scenario state from the SELECTED loop's scores/testRuns):

```tsx
import { ScenariosMetBanner } from "../components/ScenariosMetBanner";
import { VisionSection } from "../components/VisionSection";
import { VisionEditableSection } from "../VisionEditableSection";
import { DocumentsSection } from "../components/DocumentsSection";
import { summarize } from "../scenarioState";
import type { Goal, Scenario, Score, TestRun, DocumentRec } from "../types";

export function VisionTab({ teamId, slug, editable, goals, scenarios, scores, testRuns, documents }: {
  teamId: string; slug: string; editable: boolean;
  goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; documents: DocumentRec[];
}) {
  const hasScenarios = scenarios.length > 0;
  const { met, total } = summarize(scenarios, scores, testRuns);
  return (
    <>
      {hasScenarios && <ScenariosMetBanner met={met} total={total} />}
      {editable
        ? <VisionEditableSection teamId={teamId} slug={slug} goals={goals} scenarios={scenarios} scores={scores} testRuns={testRuns} documents={documents} />
        : hasScenarios && <VisionSection goals={goals} scenarios={scenarios} scores={scores} testRuns={testRuns} />}
      <DocumentsSection documents={documents} />
    </>
  );
}
```

`web/src/dashboard/tabs/LoopsTab.tsx`:

```tsx
import type { ReactNode } from "react";
import { LoopList } from "../components/LoopList";
import { LoopDetail } from "../components/LoopDetail";
import type { SelectableLoop } from "../loopView";
import type { Phase, Task, Scenario, TestRun, Revision } from "../types";

export function LoopsTab({ teamId, slug, loops, scenarios, selectedId, selected, onSelect, phases, tasks, testRuns, revisions, renderLegacyPhase, renderTask }: {
  teamId: string; slug: string; loops: SelectableLoop[]; scenarios: Scenario[]; selectedId: string; selected: SelectableLoop | undefined;
  onSelect: (id: string) => void; phases: Phase[]; tasks: Task[]; testRuns: TestRun[]; revisions: Revision[];
  renderLegacyPhase: (p: Phase) => ReactNode; renderTask: (t: Task, isCurrent: boolean) => ReactNode;
}) {
  return (
    <>
      <LoopList teamId={teamId} slug={slug} loops={loops} scenarios={scenarios} selectedId={selectedId} onSelect={onSelect} />
      {selected && <LoopDetail phases={phases} tasks={tasks} testRuns={testRuns} revisions={revisions}
        currentTaskId={selected.currentTaskId} renderLegacyPhase={renderLegacyPhase} renderTask={renderTask} />}
    </>
  );
}
```

`web/src/dashboard/tabs/BugsTab.tsx`:

```tsx
import { BugsList } from "../components/BugsList";
import type { Bug } from "../types";

export function BugsTab({ bugs }: { bugs: Bug[] }) {
  return <BugsList bugs={bugs} />;
}
```

- [ ] **Step 2: Rewrite `ProjectDetail.tsx`**

```tsx
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  useProject, usePhases, useCommits, useGoals, useScenarios, useTasks,
  useScores, useTestRuns, useRevisions, useDocuments, useTaskCommits, useLoops, useBugs,
} from "./hooks";
import { buildLoopList, defaultSelectedLoop, loopArgFor } from "./loopView";
import { ProjectHeader } from "./components/ProjectHeader";
import { Tabs, type TabKey } from "./components/Tabs";
import { LoopSelector } from "./components/LoopSelector";
import { TaskItem } from "./components/TaskItem";
import { PhaseItem } from "./components/PhaseItem";
import { Spinner } from "./components/Spinner";
import { ErrorNote } from "./components/ErrorNote";
import { EmptyState } from "./components/EmptyState";
import { DashboardTab } from "./tabs/DashboardTab";
import { VisionTab } from "./tabs/VisionTab";
import { LoopsTab } from "./tabs/LoopsTab";
import { BugsTab } from "./tabs/BugsTab";
import type { Phase, Task } from "./types";

function LegacyPhase({ teamId, slug, phase, loopId }: { teamId: string; slug: string; phase: Phase; loopId?: string }) {
  const { data } = useCommits(teamId, slug, phase.id ?? "", loopId);
  return <PhaseItem phase={phase} commits={data} />;
}
function PlanTask({ teamId, slug, task, loopId, isCurrent }: { teamId: string; slug: string; task: Task; loopId?: string; isCurrent: boolean }) {
  const { data } = useTaskCommits(teamId, slug, task.id, loopId);
  return <TaskItem task={task} commits={data} isCurrent={isCurrent} />;
}

export function ProjectDetail() {
  const { teamId = "", slug = "" } = useParams();
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [picked, setPicked] = useState<string>("");

  const project = useProject(teamId, slug);
  const loops = useLoops(teamId, slug);
  const goals = useGoals(teamId, slug);
  const scenarios = useScenarios(teamId, slug);
  const documents = useDocuments(teamId, slug);

  // Project-direct reads: detect legacy data for `main` synthesis.
  const directPhases = usePhases(teamId, slug);
  const directTasks = useTasks(teamId, slug);
  const hasProjectDirectData = directPhases.data.length > 0 || directTasks.data.length > 0;

  const loopList = buildLoopList(loops.data, project.data ?? null, hasProjectDirectData);
  const selectedId = (picked && loopList.some((l) => l.id === picked)) ? picked : defaultSelectedLoop(loopList, project.data?.currentLoopId);
  const selected = loopList.find((l) => l.id === selectedId);
  const loopArg = loopArgFor(selected);

  // Selected-loop run data (re-subscribes when loopArg changes).
  const phases = usePhases(teamId, slug, loopArg);
  const tasks = useTasks(teamId, slug, loopArg);
  const scores = useScores(teamId, slug, loopArg);
  const testRuns = useTestRuns(teamId, slug, loopArg);
  const revisions = useRevisions(teamId, slug, loopArg);
  const bugs = useBugs(teamId, slug, loopArg);

  const editable = Boolean(project.data) && project.data?.visionOwner !== "loop";
  const renderLegacyPhase = (p: Phase) => <LegacyPhase teamId={teamId} slug={slug} phase={p} loopId={loopArg} />;
  const renderTask = (t: Task, isCurrent: boolean) => <PlanTask teamId={teamId} slug={slug} task={t} loopId={loopArg} isCurrent={isCurrent} />;

  return (
    <div className="main main--narrow">
      <Link to="/dashboard" className="back">← back to dashboard</Link>
      {project.loading ? <Spinner />
        : project.error ? <ErrorNote message={project.error} />
        : project.data === null ? <EmptyState message="Project not found." />
        : (
          <>
            {project.data && <ProjectHeader project={project.data} />}
            <Tabs active={tab} onChange={setTab} />
            {tab !== "vision" && <LoopSelector loops={loopList} selectedId={selectedId} onChange={setPicked} />}

            {tab === "dashboard" && (
              <DashboardTab loops={loopList} selected={selected} status={project.data?.status}
                phases={phases.data} tasks={tasks.data} scenarios={scenarios.data} scores={scores.data} testRuns={testRuns.data} />
            )}
            {tab === "vision" && (
              <VisionTab teamId={teamId} slug={slug} editable={editable}
                goals={goals.data} scenarios={scenarios.data} scores={scores.data} testRuns={testRuns.data} documents={documents.data} />
            )}
            {tab === "loops" && (
              <LoopsTab teamId={teamId} slug={slug} loops={loopList} scenarios={scenarios.data}
                selectedId={selectedId} selected={selected} onSelect={setPicked}
                phases={phases.data} tasks={tasks.data} testRuns={testRuns.data} revisions={revisions.data}
                renderLegacyPhase={renderLegacyPhase} renderTask={renderTask} />
            )}
            {tab === "bugs" && <BugsTab bugs={bugs.data} />}
          </>
        )}
    </div>
  );
}
```

> Two phase/task subscriptions exist when `main` is selected (the `direct*` reads + the selected-loop reads with `loopArg===undefined` hit the same collection). That's an acceptable minor duplication for clarity; do not prematurely optimize.

- [ ] **Step 3: Build + run the full dashboard test suite**

Run: `cd web && npm run build && npm test`
Expected: build clean; all tests pass. Note: **no existing test asserts the old "running task is live" behavior.** `vision.test.tsx` is the only existing test that renders `TaskItem` (through `PlanSection`) — it uses a one-arg `renderTask={(t) => <TaskItem ... />}` with a `completed` task and asserts only text, so it stays green with the widened render-prop and no `isCurrent`. The new live rule is covered by the new `plan.test.tsx` (Task 3). If `npm test` surfaces any unexpected failure, fix it in place; don't expect a known `is-live` assertion to update.

- [ ] **Step 4: Commit**

```bash
git add web/src/dashboard/tabs web/src/dashboard/ProjectDetail.tsx
git commit -m "feat(web): tabbed ProjectDetail (Dashboard/Vision/Loops/Bugs) + per-loop scoping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Styles + final green

The new components reference CSS classes (`tabbar`/`tab`, `loopsel`, `rollup`, `snapshot`, `looprow`/`looplist`, `testrun(s)`, `bugrow`/`buglist`/`bugstatus`/`sev`). Add minimal styles consistent with the existing stylesheet so the UI is legible, then verify the whole suite + build.

**Files:**
- Modify: the dashboard stylesheet (find it: `grep -rl "proj-section-title\|metbanner" web/src --include=*.css`)

- [ ] **Step 1: Locate the stylesheet and the existing tokens**

Run: `grep -rl "proj-section-title" web/src --include=*.css`
Read the file; reuse its color variables / `card` / `dim` / `tnum` conventions.

- [ ] **Step 2: Add minimal styles**

Add rules for: `.tabbar`/`.tab`/`.tab--active` (a simple horizontal tab bar with an active underline); `.loopsel` (inline label + select); `.rollup`/`.rollup-item`/`.rollup-num`/`.rollup-label` (a flex strip of cards); `.snapshot`/`.snapshot-metrics`/`.snapshot-metric`/`.snapshot-current`; `.looplist`/`.looprow`/`.looprow--sel` (selectable rows, full-width buttons); `.testruns`/`.testrun`/`.testrun-summary` (the summary as a wrapped monospace `pre`); `.buglist`/`.bugrow`/`.bugstatus--open`/`.bugstatus--fixed`/`.sev--low|medium|high`. Keep it minimal and consistent — no design overhaul.

- [ ] **Step 3: Full suite + build**

Run: `cd web && npm test && npm run build`
Expected: all tests pass; build clean.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run `cd web && npm run dev` and open a project: confirm the four tabs switch, the loop selector scopes Dashboard/Loops/Bugs, a legacy project shows a single `main` loop with its existing content, and only the current task shows the live dot.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "style(web): tabs/loops/bugs/rollup/summary styling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done

- ProjectDetail shows Dashboard/Vision/Loops/Bugs tabs; the loop selector scopes Dashboard/Loops/Bugs while Vision stays project-level.
- Dashboard shows total loops, # running, project status, and the selected loop's `phases done/total`, `N/M met`, and in-progress task.
- Loops lists all loops (running marked) with per-loop progress; selecting one shows its tree + test-run summaries + revisions.
- Bugs shows the selected loop's bugs (open-first, severity/status).
- Only the loop's `currentTaskId` renders as live; other tasks render stored status.
- Legacy project-direct projects render as a single synthesized `main` loop, content unchanged.
- `web` build clean; all web tests pass (the new live rule is covered by `plan.test.tsx`; no existing test asserted `is-live`-on-running).

> Note: `buildLoopList` takes 3 args (`loops, project, hasProjectDirectData`) in this plan vs the spec's 2-arg sketch — a deliberate refinement so the synthesized `main` carries the project doc's `status`/`currentPhaseId`/`currentTaskId` (which the spec requires).

## Out of scope (separate sub-projects / deferred)

- SP3 `/daloop` driver hygiene (task-status transitions, opening/fixing bugs, uploading summaries, `loop start`).
- Cross-loop bug aggregation ("All loops" view); per-loop notifications (v2.3); URL deep-linking of tab/loop.
