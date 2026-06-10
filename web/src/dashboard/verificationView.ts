import type { Verification } from "./types";
import { latestById } from "./scenarioState";

export type VerificationVerdict = "confirmed" | "refuted";

/** Verdict of the latest (highest ULID id) verification targeting this test-run; undefined when unverified. */
export function verdictForTestRun(testRunId: string, verifications: Verification[]): VerificationVerdict | undefined {
  return latestById(verifications.filter((v) => v.testRunId === testRunId))?.verdict;
}

/** Scenario-level badge verdict: the verdict for the scenario's LATEST test-run.
 *  A verification of an older run does not count — only the latest run's evidence matters. */
export function scenarioVerification(scenarioId: string, latestTestRunId: string | null, verifications: Verification[]): VerificationVerdict | undefined {
  if (!latestTestRunId) return undefined;
  return verdictForTestRun(latestTestRunId, verifications.filter((v) => v.scenarioId === scenarioId));
}
