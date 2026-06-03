import { isTerminal, type Status } from "./status.js";

export interface PhaseLite { id: string; order: number; status: Status; }
export interface TaskLite { id: string; phaseId: string; order: number; status: Status; }

function byOrderThenId(a: { order: number; id: string }, b: { order: number; id: string }): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Lowest-order non-terminal phase; tiebreak by id. Null if all phases are terminal. */
export function computeCurrentPhaseId(phases: PhaseLite[]): string | null {
  const open = phases.filter((p) => !isTerminal(p.status)).sort(byOrderThenId);
  return open.length > 0 ? open[0].id : null;
}

/** Lowest-order non-terminal task in the current phase; tiebreak by id. Null if no current phase. */
export function computeCurrentTaskId(currentPhaseId: string | null, tasks: TaskLite[]): string | null {
  if (!currentPhaseId) return null;
  const open = tasks.filter((t) => t.phaseId === currentPhaseId && !isTerminal(t.status)).sort(byOrderThenId);
  return open.length > 0 ? open[0].id : null;
}
