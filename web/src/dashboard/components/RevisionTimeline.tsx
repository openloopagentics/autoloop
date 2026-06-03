import type { Revision } from "../types";

export function RevisionTimeline({ revisions }: { revisions: Revision[] }) {
  if (revisions.length === 0) return null;
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Revisions</h2></div>
      <ul className="revlist">
        {revisions.map((r) => (
          <li key={r.id} className="revrow card">
            <div className="revrow-trigger">
              <span className="revrow-scn mono">{r.trigger?.scenarioId}</span>
              <span className="revrow-reason">{r.trigger?.reason}</span>
            </div>
            <ul className="revchanges">
              {(r.changes ?? []).map((c, i) => (
                <li key={i} className="revchange"><code className="mono">{c.op}</code> <span className="mono">{c.taskId}</span></li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
