import { explainScenario, type ExplanationReason } from "./whyModel";
import type { Scenario, Score, TestRun, Verification } from "./types";

export const DEFAULT_THRESHOLD = 80;

/** The element with the lexically greatest `id` (events are ULID-keyed → id order == time order). */
export function latestById<T extends { id: string }>(items: T[]): T | null {
  let best: T | null = null;
  for (const it of items) if (best === null || it.id > best.id) best = it;
  return best;
}

export interface ScenarioStatus {
  state: "met" | "unmet";
  latestComposite: number | null;
  latestTest: TestRun | null;
  reasons: ExplanationReason[];
}

/** Verification-aware scenario status: state/reasons from explainScenario (the canonical
 *  3-condition rule), plus latestComposite/latestTest for display. Replaces deriveScenarioState. */
export function scenarioStatus(scenario: Scenario, scores: Score[], testRuns: TestRun[], verifications: Verification[], blockedIds?: Set<string>): ScenarioStatus {
  const ex = explainScenario(scenario, scores, testRuns, verifications, blockedIds);
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
export function summarize(scenarios: Scenario[], scores: Score[], testRuns: TestRun[], verifications: Verification[], blockedIds?: Set<string>): { met: number; total: number } {
  let met = 0;
  for (const s of scenarios) if (scenarioStatus(s, scores, testRuns, verifications, blockedIds).state === "met") met++;
  return { met, total: scenarios.length };
}
