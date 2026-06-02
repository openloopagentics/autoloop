import { StatusBadge } from "./StatusBadge";
import { CommitItem } from "./CommitItem";
import type { Phase, Commit } from "../types";

export function PhaseItem({ phase, commits }: { phase: Phase; commits: Commit[] }) {
  const isCur = phase.status === "running";
  return (
    <div className={`phaserow card${isCur ? " phaserow--cur" : ""}`}>
      <div className="phaserow-head">
        {phase.status && <span className={`sdot s-${phase.status}${phase.status === "running" ? " is-live" : ""}`} aria-hidden="true" />}
        <span className="phaserow-name">{phase.name}</span>
        {phase.status && <StatusBadge status={phase.status} />}
        <span className="phaserow-count tnum">{commits.length} commit{commits.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="phaserow-body">
        {commits.length === 0
          ? <div className="empty" style={{ padding: "8px 2px" }}>No commits yet</div>
          : <ul className="commits">{commits.map((c) => <CommitItem key={c.sha} commit={c} />)}</ul>}
      </div>
    </div>
  );
}
