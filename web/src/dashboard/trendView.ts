import type { Bug, Commit, Loop, Scenario, Score, Task, TestRun } from "./types";
import { deriveScenarioState, latestById } from "./scenarioState";
import { MAIN_ID } from "./loopView";

/** The implicit `main` loop predates loop-level adoption and has no `order` —
 *  it always sorts FIRST in a trend (oldest). */
export const MAIN_TREND_ORDER = -1;

/** Trend fan-out cap. Older loops fall silently outside the window; the strip
 *  labels the window ("last N loops") per the no-silent-truncation rule. */
export const TREND_LOOPS_MAX = 20;

export interface LoopRunData {
  loop: Loop;
  scores: Score[];
  testRuns: TestRun[];
  bugs: Bug[];
  taskCommits: Commit[];
  tasks: Task[];
}

export interface TrendPoint {
  loopId: string;
  order: number;
  metCount: number;
  scenarioTotal: number;        // scenarios tagged in this loop's tasks[].scenarioIds
  avgComposite: number | null;  // mean of latest composite per tagged scenario
  bugsOpened: number;
  bugsFixed: number;
  tokensTotal: number;          // Σ taskCommit.tokens.total (missing ⇒ 0)
}

/** The trend window: implicit `main` first (when the project has project-direct data),
 *  then explicit loops ascending by order — capped to the most recent TREND_LOOPS_MAX.
 *  `loops` must already be ascending by order (useLoops queries orderBy("order")). */
export function trendWindow(loops: Loop[], includeMain: boolean): Loop[] {
  const combined = includeMain ? [{ id: MAIN_ID } as Loop, ...loops] : [...loops];
  return combined.slice(-TREND_LOOPS_MAX);
}

/** Per-loop trend series, ascending by order (main first). A loop is judged on what it
 *  attempted: only scenarios tagged in ITS tasks count, and met-state is derived from
 *  ITS loop-scoped events via the existing deriveScenarioState predicate (no refactor). */
export function buildTrend(loops: LoopRunData[], scenarios: Scenario[]): TrendPoint[] {
  const points = loops.map((d) => {
    const tagged = new Set(d.tasks.flatMap((t) => t.scenarioIds ?? []));
    const taggedScenarios = scenarios.filter((s) => tagged.has(s.id));
    let metCount = 0;
    const composites: number[] = [];
    for (const s of taggedScenarios) {
      if (deriveScenarioState(s, d.scores, d.testRuns).state === "met") metCount++;
      const latest = latestById(d.scores.filter((sc) => sc.scenarioId === s.id));
      if (latest?.composite !== undefined) composites.push(latest.composite);
    }
    return {
      loopId: d.loop.id,
      order: d.loop.order ?? MAIN_TREND_ORDER,
      metCount,
      scenarioTotal: taggedScenarios.length,
      avgComposite: composites.length ? composites.reduce((a, b) => a + b, 0) / composites.length : null,
      bugsOpened: d.bugs.length, // every bug recorded in L was opened there
      bugsFixed: d.bugs.filter((b) => b.status === "fixed").length,
      tokensTotal: d.taskCommits.reduce((sum, c) => sum + (c.tokens?.total ?? 0), 0),
    };
  });
  return points.sort((a, b) => a.order - b.order || a.loopId.localeCompare(b.loopId));
}

/** SVG polyline `points` attribute for a series. X advances by index across the full
 *  width; nulls are skipped (the line connects across the gap). A flat series renders
 *  at mid-height. Returns "" when there is nothing to plot. */
export function polylinePoints(values: (number | null)[], width: number, height: number, pad = 2): string {
  const pts: Array<[number, number]> = [];
  values.forEach((v, i) => { if (v !== null) pts.push([i, v]); });
  if (pts.length === 0) return "";
  const lastX = values.length - 1 || 1;
  const nums = pts.map(([, v]) => v);
  const min = Math.min(...nums);
  const span = Math.max(...nums) - min;
  return pts
    .map(([i, v]) => {
      const x = pad + (i / lastX) * (width - 2 * pad);
      const y = span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
