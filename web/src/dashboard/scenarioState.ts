import { explainScenario, type ExplanationReason } from "./whyModel";
import type { Scenario, Score, TestRun, Verification } from "./types";

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

/** Count how many scenarios are met (verification-aware). */
export function summarize(scenarios: Scenario[], scores: Score[], testRuns: TestRun[], verifications: Verification[]): { met: number; total: number } {
  let met = 0;
  for (const s of scenarios) if (scenarioStatus(s, scores, testRuns, verifications).state === "met") met++;
  return { met, total: scenarios.length };
}
