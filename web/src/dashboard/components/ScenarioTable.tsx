import { deriveScenarioState, DEFAULT_THRESHOLD } from "../scenarioState";
import type { Scenario, Score, TestRun } from "../types";

function ScenarioRow({ scenario, scores, testRuns }: { scenario: Scenario; scores: Score[]; testRuns: TestRun[] }) {
  const { state, latestComposite, latestTest } = deriveScenarioState(scenario, scores, testRuns);
  const threshold = scenario.threshold ?? DEFAULT_THRESHOLD;
  const pct = Math.max(0, Math.min(100, latestComposite ?? 0));
  return (
    <tr className={`scnrow scn-${state}`}>
      <td className="scnrow-name">
        <span className="scnrow-title">{scenario.title ?? scenario.id}</span>
        {scenario.description && <span className="scnrow-desc dim">{scenario.description}</span>}
      </td>
      <td className="scnrow-status"><span className={`scnbadge scn-${state}`}>{state}</span></td>
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

export function ScenarioTable({ scenarios, scores, testRuns }: { scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[] }) {
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
        {scenarios.map((s) => <ScenarioRow key={s.id} scenario={s} scores={scores} testRuns={testRuns} />)}
      </tbody>
    </table>
  );
}
