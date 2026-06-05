import { useState } from "react";
import type { Scenario, TestRun } from "../types";

/** Latest run (highest ULID id) for a scenario. */
function latest(runs: TestRun[]): TestRun | null {
  let best: TestRun | null = null;
  for (const r of runs) if (best === null || r.id > best.id) best = r;
  return best;
}

function ScenarioTests({ title, scenarioId, runs }: { title: string; scenarioId: string; runs: TestRun[] }) {
  const [open, setOpen] = useState(false);
  const last = latest(runs);
  const hasRuns = runs.length > 0;
  const passing = !!last && (last.failed ?? 0) === 0 && (last.passed ?? 0) > 0;
  const state = !hasRuns ? "none" : passing ? "pass" : "fail";
  const ordered = [...runs].sort((a, b) => (a.id < b.id ? 1 : -1)); // latest first
  return (
    <div className={`testscn testscn--${state}`}>
      <button type="button" className="testscn-head" onClick={() => hasRuns && setOpen((o) => !o)} disabled={!hasRuns}>
        <span className="testscn-caret">{hasRuns ? (open ? "▾" : "▸") : "·"}</span>
        <span className="testscn-title">{title}</span>
        <span className="testscn-id dim">{scenarioId}</span>
        {hasRuns
          ? <span className={`testscn-badge testscn-badge--${state}`}>{last!.passed ?? 0}/{(last!.passed ?? 0) + (last!.failed ?? 0)} {passing ? "✓" : "✗"}</span>
          : <span className="testscn-badge testscn-badge--none">no test</span>}
        {runs.length > 1 && <span className="testscn-count dim">{runs.length} runs</span>}
      </button>
      {open && hasRuns && (
        <ul className="testscn-runs">
          {ordered.map((r) => (
            <li key={`${r.loopId ?? "main"}:${r.id}`} className="testrun-item">
              <div className="testrun-item-head">
                <span className="testrun-counts tnum">{r.passed ?? 0} passed · {r.failed ?? 0} failed</span>
                {r.loopId && <span className="testrun-loop dim">{r.loopId}</span>}
                {r.taskId && <span className="testrun-task dim">task {r.taskId}</span>}
              </div>
              {r.summary && <pre className="testrun-summary">{r.summary}</pre>}
              {r.issues && r.issues.length > 0 && (
                <ul className="testrun-issues">{r.issues.map((iss, i) => <li key={i} className="dim">{iss}</li>)}</ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TestsTab({ scenarios, testRuns }: { scenarios: Scenario[]; testRuns: TestRun[] }) {
  const byScenario = (id: string) => testRuns.filter((r) => r.scenarioId === id);
  // Scenarios from the vision, plus any scenarioId that appears in a test run but isn't in the vision list.
  const known = new Set(scenarios.map((s) => s.id));
  const extraIds = [...new Set(testRuns.map((r) => r.scenarioId).filter((id): id is string => !!id && !known.has(id)))];
  const tested = scenarios.filter((s) => byScenario(s.id).length > 0);
  const untested = scenarios.filter((s) => byScenario(s.id).length === 0);

  if (scenarios.length === 0 && testRuns.length === 0) {
    return <div className="empty">No tests yet — they appear as the loop verifies each scenario.</div>;
  }
  return (
    <section className="teststab">
      <div className="proj-section-head"><h2 className="proj-section-title">Tests</h2></div>
      <div className="testscn-list">
        {tested.map((s) => <ScenarioTests key={s.id} title={s.title ?? s.id} scenarioId={s.id} runs={byScenario(s.id)} />)}
        {extraIds.map((id) => <ScenarioTests key={id} title={id} scenarioId={id} runs={byScenario(id)} />)}
        {untested.map((s) => <ScenarioTests key={s.id} title={s.title ?? s.id} scenarioId={s.id} runs={[]} />)}
      </div>
    </section>
  );
}
