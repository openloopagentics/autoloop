import { scenarioStatus, DEFAULT_THRESHOLD } from "../scenarioState";
import { scenarioVerification } from "../verificationView";
import { VerificationBadge } from "./VerificationBadge";
import type { Scenario, Score, TestRun, Verification } from "../types";

function ScenarioRow({ scenario, scores, testRuns, verifications = [] }: { scenario: Scenario; scores: Score[]; testRuns: TestRun[]; verifications?: Verification[] }) {
  const { state, latestComposite, latestTest } = scenarioStatus(scenario, scores, testRuns, verifications ?? []);
  const verdict = scenarioVerification(scenario.id, latestTest?.id ?? null, verifications);
  const threshold = scenario.threshold ?? DEFAULT_THRESHOLD;
  const pct = Math.max(0, Math.min(100, latestComposite ?? 0));
  return (
    <tr className={`scnrow scn-${state}`}>
      <td className="scnrow-name">
        <span className="scnrow-title">{scenario.title ?? scenario.id}</span>
        {scenario.description && <span className="scnrow-desc dim">{scenario.description}</span>}
      </td>
      <td className="scnrow-status"><span className={`scnbadge scn-${state}`}>{state}</span>{" "}<VerificationBadge verdict={verdict} compact showUnverified /></td>
      <td className="scnrow-score">
        <div className="scorebar" role="img" aria-label={`composite ${latestComposite ?? 0} of 100, threshold ${threshold}`}>
          <div className="scorebar-fill" style={{ width: `${pct}%` }} />
          <div className="scorebar-thresh" style={{ left: `${threshold}%` }} />
        </div>
        <span className="scorebar-val tnum">{latestComposite ?? "—"}</span>
      </td>
      <td className="scnrow-tests dim tnum">
        {latestTest ? `${latestTest.passed ?? 0}/${(latestTest.passed ?? 0) + (latestTest.failed ?? 0)}` : "—"}
      </td>
    </tr>
  );
}

export function ScenarioTable({ scenarios, scores, testRuns, verifications = [] }: { scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; verifications?: Verification[] }) {
  return (
    <table className="scntable">
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Status</th>
          <th>Composite</th>
          <th>Tests</th>
        </tr>
      </thead>
      <tbody>
        {scenarios.map((s) => <ScenarioRow key={s.id} scenario={s} scores={scores} testRuns={testRuns} verifications={verifications} />)}
      </tbody>
    </table>
  );
}
