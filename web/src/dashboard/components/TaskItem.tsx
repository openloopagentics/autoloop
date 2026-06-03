import { StatusBadge } from "./StatusBadge";
import { CommitItem } from "./CommitItem";
import type { Task, Commit } from "../types";

export function TaskItem({ task, commits }: { task: Task; commits: Commit[] }) {
  return (
    <div className="taskrow">
      <div className="taskrow-head">
        {task.status && <span className={`sdot s-${task.status}${task.status === "running" ? " is-live" : ""}`} aria-hidden="true" />}
        <span className="taskrow-name">{task.title ?? task.id}</span>
        {task.status && <StatusBadge status={task.status} />}
        {task.scenarioIds && task.scenarioIds.length > 0 && (
          <span className="taskrow-scns dim">{task.scenarioIds.join(", ")}</span>
        )}
        <span className="taskrow-count tnum">{commits.length} commit{commits.length !== 1 ? "s" : ""}</span>
      </div>
      {commits.length > 0 && <ul className="commits">{commits.map((c) => <CommitItem key={c.sha} commit={c} />)}</ul>}
    </div>
  );
}
