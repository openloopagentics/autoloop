import type { Loop, Phase, Project } from "./types";
import { isTerminalStatus } from "./status";

export const MAIN_ID = "main";

export interface SelectableLoop {
  id: string; isMain: boolean;
  goal?: string; name?: string; status?: string; order?: number;
  currentPhaseId?: string | null; currentTaskId?: string | null;
}

/** Firestore path segments for a (loop-scoped or project-direct) collection root. */
export function basePath(teamId: string, slug: string, loopId?: string): [string, ...string[]] {
  const base: [string, ...string[]] = ["teams", teamId, "projects", slug];
  return loopId ? [...base, "loops", loopId] : base;
}

/** Explicit loops (sorted by order then id) + a synthesized `main` when the project has legacy
 *  project-direct data. `main` carries the PROJECT doc's status/currentPhaseId/currentTaskId. */
export function buildLoopList(loops: Loop[], project: Project | null | undefined, hasProjectDirectData: boolean): SelectableLoop[] {
  const list: SelectableLoop[] = [...loops]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
    .map((l) => ({
      id: l.id, isMain: false, goal: l.goal, name: l.name, status: l.status, order: l.order,
      currentPhaseId: l.currentPhaseId, currentTaskId: l.currentTaskId,
    }));
  if (hasProjectDirectData) {
    list.push({
      id: MAIN_ID, isMain: true, name: "main", status: project?.status,
      currentPhaseId: project?.currentPhaseId, currentTaskId: project?.currentTaskId,
    });
  }
  return list;
}

/** Default selection: a valid currentLoopId → else the most-recent explicit loop (highest order)
 *  → else main → else "" (empty list). */
export function defaultSelectedLoop(list: SelectableLoop[], currentLoopId?: string | null): string {
  if (list.length === 0) return "";
  if (currentLoopId && list.some((l) => l.id === currentLoopId)) return currentLoopId;
  const explicit = list.filter((l) => !l.isMain);
  if (explicit.length > 0) return explicit[explicit.length - 1].id; // list is asc by order
  return list[list.length - 1].id; // main
}

/** Phase progress: done = terminal-status phases (completed/failed/cancelled). */
export function phaseProgress(phases: Phase[]): { done: number; total: number } {
  let done = 0;
  for (const p of phases) if (p.status && isTerminalStatus(p.status)) done++;
  return { done, total: phases.length };
}

export function loopIsRunning(loop: { status?: string }): boolean {
  return loop.status === "running";
}

/** Hook arg for a selectable loop: undefined for main (project-direct), else its id. */
export function loopArgFor(loop: SelectableLoop | undefined): string | undefined {
  return !loop || loop.isMain ? undefined : loop.id;
}
