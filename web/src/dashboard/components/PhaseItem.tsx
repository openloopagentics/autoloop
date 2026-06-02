import { StatusBadge } from "./StatusBadge";
import { CommitItem } from "./CommitItem";
import { EmptyState } from "./EmptyState";
import type { Phase, Commit } from "../types";

export function PhaseItem({ phase, commits }: { phase: Phase; commits: Commit[] }) {
  return (
    <div className="phase">
      <h3>{phase.name} {phase.status && <StatusBadge status={phase.status} />}</h3>
      {commits.length === 0 ? <EmptyState message="No commits yet" />
        : <ul>{commits.map((c) => <CommitItem key={c.sha} commit={c} />)}</ul>}
    </div>
  );
}
