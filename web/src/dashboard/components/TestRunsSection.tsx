import type { TestRun } from "../types";

export function TestRunsSection({ testRuns }: { testRuns: TestRun[] }) {
  if (testRuns.length === 0) return null;
  const sorted = [...testRuns].sort((a, b) => (a.id < b.id ? 1 : -1)); // latest (highest id) first
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Test runs</h2></div>
      <ul className="testruns">
        {sorted.map((r) => (
          <li key={r.id} className="testrun card">
            <div className="testrun-head">
              <span className="testrun-counts tnum">{r.passed ?? 0} passed · {r.failed ?? 0} failed</span>
              {r.scenarioId && <span className="testrun-scn dim">{r.scenarioId}</span>}
            </div>
            {r.summary && <pre className="testrun-summary">{r.summary}</pre>}
          </li>
        ))}
      </ul>
    </section>
  );
}
