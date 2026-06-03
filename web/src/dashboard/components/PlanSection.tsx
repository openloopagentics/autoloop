import type { ReactNode } from "react";
import type { Phase, Task } from "../types";

interface Props {
  phases: Phase[];
  tasks: Task[];
  renderLegacyPhase: (phase: Phase) => ReactNode;
  renderTask: (task: Task) => ReactNode;
}

export function PlanSection({ phases, tasks, renderLegacyPhase, renderTask }: Props) {
  if (tasks.length === 0) {
    return (
      <section>
        <div className="proj-section-head"><h2 className="proj-section-title">Phases</h2></div>
        {phases.length === 0
          ? <div className="empty">No phases yet.</div>
          : <div className="phaselist">{phases.map((p) => <div key={p.id}>{renderLegacyPhase(p)}</div>)}</div>}
      </section>
    );
  }
  const tasksFor = (phaseId: string) => tasks.filter((t) => t.phaseId === phaseId);
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Tasks</h2></div>
      <div className="planlist">
        {phases.map((p) => (
          <div key={p.id} className="planphase card">
            <div className="planphase-head"><span className="planphase-name">{p.name ?? p.id}</span></div>
            <div className="tasklist">{tasksFor(p.id ?? "").map((t) => <div key={t.id}>{renderTask(t)}</div>)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
