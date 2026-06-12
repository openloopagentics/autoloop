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
