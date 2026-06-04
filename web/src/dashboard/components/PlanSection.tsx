import type { ReactNode } from "react";
import type { Phase, Task } from "../types";

interface Props {
  phases: Phase[];
  tasks: Task[];
  currentTaskId?: string | null;
  renderLegacyPhase: (phase: Phase) => ReactNode;
  renderTask: (task: Task, isCurrent: boolean) => ReactNode;
}

export function PlanSection({ phases, tasks, currentTaskId, renderLegacyPhase, renderTask }: Props) {
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
  // Phases that have at least one task; fall back to a synthetic "ungrouped" phase so
  // tasks are always visible even when phase docs haven't loaded yet.
  const activePhasesIds = new Set(tasks.map((t) => t.phaseId).filter(Boolean));
  const visiblePhases = phases.length > 0
    ? phases
    : [...activePhasesIds].map((id) => ({ id, name: id } as { id: string; name: string }));
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Tasks</h2></div>
      <div className="planlist">
        {visiblePhases.map((p) => (
          <div key={p.id} className="planphase card">
            <div className="planphase-head"><span className="planphase-name">{(p as { name?: string }).name ?? p.id}</span></div>
            <div className="tasklist">{tasksFor(p.id ?? "").map((t) => <div key={t.id}>{renderTask(t, t.id === currentTaskId)}</div>)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
