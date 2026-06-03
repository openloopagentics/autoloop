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
