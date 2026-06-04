import type { Bug } from "../types";

export function BugItem({ bug }: { bug: Bug }) {
  const status = bug.status ?? "open";
  return (
    <div className={`bugrow card bug--${status}`}>
      <div className="bugrow-head">
        <span className="bugrow-title">{bug.title ?? bug.id}</span>
        {bug.severity && <span className={`sev sev--${bug.severity}`}>{bug.severity}</span>}
        <span className={`bugstatus bugstatus--${status}`}>{status}</span>
      </div>
      {bug.description && <p className="bugrow-desc dim">{bug.description}</p>}
      {(bug.scenarioId || bug.taskId) && (
        <div className="bugrow-refs dim">
          {bug.scenarioId && <span>scenario {bug.scenarioId}</span>}
          {bug.taskId && <span>task {bug.taskId}</span>}
        </div>
      )}
    </div>
  );
}
