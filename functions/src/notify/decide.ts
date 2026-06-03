export type State = "met" | "unmet";
interface HasId { id: string }
interface ScoreLike extends HasId { scenarioId?: string; composite?: number }
interface RunLike extends HasId { scenarioId?: string; failed?: number }
interface ScenarioLike { id: string; threshold?: number }

export const DEFAULT_THRESHOLD = 80;
function latestById<T extends HasId>(xs: T[]): T | null {
  let best: T | null = null;
  for (const x of xs) if (best === null || x.id > best.id) best = x;
  return best;
}

export function deriveState(scenario: ScenarioLike, scores: ScoreLike[], testRuns: RunLike[]): State {
  const s = latestById(scores.filter((x) => x.scenarioId === scenario.id));
  const r = latestById(testRuns.filter((x) => x.scenarioId === scenario.id));
  const threshold = scenario.threshold ?? DEFAULT_THRESHOLD;
  const met = s != null && (s.composite ?? -1) >= threshold && r != null && (r.failed ?? 0) === 0;
  return met ? "met" : "unmet";
}

/** newState + a notification type when it should fire. First write: notify only if met. */
export function decideScenarioNotification(scenario: ScenarioLike, scores: ScoreLike[], testRuns: RunLike[], lastState: State | undefined): { newState: State; type?: "scenario_met" | "scenario_unmet" } {
  const newState = deriveState(scenario, scores, testRuns);
  if (lastState === undefined) return newState === "met" ? { newState, type: "scenario_met" } : { newState };
  if (newState === lastState) return { newState };
  return { newState, type: newState === "met" ? "scenario_met" : "scenario_unmet" };
}

export function allMet(scenarios: ScenarioLike[], scoresByScn: Record<string, ScoreLike[]>, runsByScn: Record<string, RunLike[]>): boolean {
  if (scenarios.length === 0) return false;
  return scenarios.every((s) => deriveState(s, scoresByScn[s.id] ?? [], runsByScn[s.id] ?? []) === "met");
}
