import { scenarioStatus, DEFAULT_THRESHOLD } from "../scenarioState";
import { scenarioVerification } from "../verificationView";
import { VerificationBadge } from "./VerificationBadge";
import type { Scenario, Score, TestRun, Verification } from "../types";

export function ScenarioCard({ scenario, scores, testRuns, verifications = [] }: { scenario: Scenario; scores: Score[]; testRuns: TestRun[]; verifications?: Verification[] }) {
  const { state, latestComposite, latestTest, reasons } = scenarioStatus(scenario, scores, testRuns, verifications);
  const verdict = scenarioVerification(scenario.id, latestTest?.id ?? null, verifications);
  const threshold = scenario.threshold ?? DEFAULT_THRESHOLD;
  const pct = Math.max(0, Math.min(100, latestComposite ?? 0));
  const history = scores.filter((s) => s.scenarioId === scenario.id).sort((a, b) => (a.id < b.id ? -1 : 1));
  return (
    <div className={`scncard card scn-${state}`}>
      <div className="scncard-head">
        <span className="scncard-title">{scenario.title ?? scenario.id}</span>
        <VerificationBadge verdict={verdict} compact showUnverified />
        <span className={`scnbadge scn-${state}`}>{state}</span>
      </div>
      {scenario.description && <p className="scncard-desc">{scenario.description}</p>}
      <div className="scncard-score">
        <div className="scorebar" role="img" aria-label={`composite ${latestComposite ?? 0} of 100, threshold ${threshold}`}>
          <div className="scorebar-fill" style={{ width: `${pct}%` }} />
          <div className="scorebar-thresh" style={{ left: `${threshold}%` }} />
        </div>
        <span className="scorebar-val tnum">{latestComposite ?? "—"}</span>
      </div>
      <div className="scncard-test dim">
        {latestTest ? <>tests: <span className="tnum">{latestTest.passed ?? 0}</span> passed, <span className="tnum">{latestTest.failed ?? 0}</span> failed</> : "no test run yet"}
      </div>
      {reasons.length > 0 && (
        <ul className="scncard-reasons">
          {reasons.map((r, i) => (
            <li key={i} className={`scnreason ${r.ok ? "scnreason-ok" : "scnreason-fail"}`}>
              <span className={`scnbadge scn-${r.ok ? "met" : "unmet"}`}>{r.ok ? "✓" : "✗"}</span>
              {" "}{r.text}
            </li>
          ))}
        </ul>
      )}
      {history.length > 1 && (
        <details className="scncard-hist">
          <summary>score history ({history.length})</summary>
          <ul className="scnhist">{history.map((s) => <li key={s.id} className="tnum">{s.composite ?? "—"}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
