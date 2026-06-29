import type { WhyModel, WhySubject, WhyDecision, WhyEvidence } from "../whyModel";

/** The bare record id behind a graph node id (e.g. "scenario:s1" → "s1"). */
function bareId(nodeId: string): string {
  const i = nodeId.indexOf(":");
  return i === -1 ? nodeId : nodeId.slice(i + 1);
}

/** One-line summary of a piece of evidence, per kind. */
function evidenceText(ev: WhyEvidence): string {
  const d = ev.detail;
  switch (ev.kind) {
    case "score": return d.composite != null ? `score ${String(d.composite)}${d.note ? ` · ${String(d.note)}` : ""}` : "score recorded";
    case "test-run": { const f = Number(d.failed ?? 0); return f > 0 ? `${f} test(s) failing` : "all tests passing"; }
    case "verification": return d.verdict === "refuted" ? `refuted${d.summary ? `: ${String(d.summary)}` : ""}` : "verification confirmed";
    case "commit": return typeof d.sha === "string" ? `commit ${d.sha.slice(0, 7)}` : "commit";
    default: return ev.kind;
  }
}

function SubjectBody({ model, subject }: { model: WhyModel; subject: WhySubject }) {
  const bare = bareId(subject.id);
  const evidence = model.evidence.filter((e) => e.subjectId === subject.id);
  const decisions = model.decisions.filter((d) => d.refs.scenarioIds.includes(bare) || d.refs.taskIds.includes(bare));
  const reasons = subject.explanation?.reasons ?? [];
  return (
    <div className="whypanel">
      <div className="whypanel-head">
        <h3>{subject.label}</h3>
        {subject.explanation && <span className={`scnbadge scn-${subject.explanation.state}`}>{subject.explanation.state}</span>}
      </div>
      {reasons.length > 0 && (
        <ul className="scncard-reasons">
          {reasons.map((r, i) => (
            <li key={i} className={`scnreason ${r.ok ? "scnreason-ok" : "scnreason-fail"}`}>
              <span className={`scnbadge scn-${r.ok ? "met" : "unmet"}`}>{r.ok ? "✓" : "✗"}</span> {r.text}
            </li>
          ))}
        </ul>
      )}
      {evidence.length > 0 && (
        <div className="whypanel-sec">
          <h4>Evidence</h4>
          <ul className="whypanel-list">
            {evidence.map((e) => <li key={e.id} className={`whyev whyev--${e.relation}`}>{evidenceText(e)}</li>)}
          </ul>
        </div>
      )}
      {decisions.length > 0 && (
        <div className="whypanel-sec">
          <h4>Decisions</h4>
          <ul className="whypanel-list">
            {decisions.map((d) => (
              <li key={d.id} className="whydec">
                <span className="whydec-kind">{d.kind}</span> {d.summary}
                {d.rationale && <span className="dim"> — {d.rationale}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DecisionBody({ decision }: { decision: WhyDecision }) {
  return (
    <div className="whypanel">
      <div className="whypanel-head">
        <h3>{decision.summary || "decision"}</h3>
        <span className="whydec-kind">{decision.kind}</span>
      </div>
      {decision.rationale && <p className="whypanel-rationale">{decision.rationale}</p>}
      {decision.alternatives && decision.alternatives.length > 0 && (
        <div className="whypanel-sec">
          <h4>Alternatives considered</h4>
          <ul className="whypanel-list">{decision.alternatives.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function EvidenceBody({ evidence }: { evidence: WhyEvidence }) {
  return (
    <div className="whypanel">
      <div className="whypanel-head">
        <h3>{evidenceText(evidence)}</h3>
        <span className={`whyev whyev--${evidence.relation}`}>{evidence.relation}</span>
      </div>
      <ul className="whypanel-list">
        {Object.entries(evidence.detail).filter(([, v]) => v != null && v !== "").map(([k, v]) => (
          <li key={k}><strong>{k}:</strong> {String(v)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Read-only detail for a selected graph node: subject reasons+evidence+decisions,
 *  a decision's rationale+alternatives, or an evidence row's detail. Pure read off the model. */
export function WhyPanel({ model, nodeId, onClose }: { model: WhyModel; nodeId: string; onClose: () => void }) {
  const subject = model.subjects.find((s) => s.id === nodeId);
  const decision = model.decisions.find((d) => d.id === nodeId);
  const evidence = model.evidence.find((e) => e.id === nodeId);
  return (
    <aside className="map-panel card" aria-label="why detail">
      <button type="button" className="map-panel-close" aria-label="close" onClick={onClose}>×</button>
      {subject ? <SubjectBody model={model} subject={subject} />
        : decision ? <DecisionBody decision={decision} />
        : evidence ? <EvidenceBody evidence={evidence} />
        : <p className="dim">No detail for this node.</p>}
    </aside>
  );
}
