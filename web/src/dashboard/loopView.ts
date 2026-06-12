import type { Loop, Phase, Project } from "./types";
import { isTerminalStatus } from "./status";
import { tsMillis } from "./mapTimeline";

export const MAIN_ID = "main";

/** Newest-iteration-first comparator: RUNNING loops first, then startedAt desc (the
 *  server-stamped truth — agent-supplied `order` demoted to a tie-break because drivers
 *  have been seen reusing low orders for new loops), then order desc, then numeric-aware
 *  id desc (so same-rank ids like `loop-…-10` sort above `loop-…-9`, not lexicographically). */
function newestFirst(
  a: { id: string; order?: number; status?: string; startedAt?: unknown },
  b: { id: string; order?: number; status?: string; startedAt?: unknown },
): number {
  return Number(b.status === "running") - Number(a.status === "running")
    || (tsMillis(b.startedAt) ?? 0) - (tsMillis(a.startedAt) ?? 0)
    || (b.order ?? 0) - (a.order ?? 0)
    || b.id.localeCompare(a.id, undefined, { numeric: true });
}

export interface SelectableLoop {
  id: string; isMain: boolean;
  goal?: string; name?: string; status?: string; order?: number;
  startedAt?: unknown; // server-stamped at loop create — shown on the row, drives ordering
  currentPhaseId?: string | null; currentTaskId?: string | null;
  previewUrl?: string | null;
}

/** Firestore path segments for a (loop-scoped or project-direct) collection root. */
export function basePath(teamId: string, slug: string, loopId?: string): [string, ...string[]] {
  const base: [string, ...string[]] = ["teams", teamId, "projects", slug];
  return loopId ? [...base, "loops", loopId] : base;
}

/** Explicit loops (running first, then latest startedAt — see newestFirst) + a synthesized
 *  `main` (always last — the oldest, pre-loop data) when the project has legacy
 *  project-direct data. `main` carries the PROJECT doc's status/phase/task. */
export function buildLoopList(loops: Loop[], project: Project | null | undefined, hasProjectDirectData: boolean): SelectableLoop[] {
  const list: SelectableLoop[] = [...loops]
    .sort(newestFirst)
    .map((l) => ({
      id: l.id, isMain: false, goal: l.goal, name: l.name, status: l.status, order: l.order,
      startedAt: l.startedAt,
      currentPhaseId: l.currentPhaseId, currentTaskId: l.currentTaskId,
      previewUrl: l.previewUrl,
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
  if (explicit.length > 0) return explicit[0].id; // list is desc by order → [0] is latest
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

/** A project's effective status. "running" only when a loop is actually running; otherwise the
 *  latest loop's status (so a project with no running loop reflects its loops, not a stale flag).
 *  Falls back to the stored project status when the project has no loops. */
export function effectiveProjectStatus(
  loops: { id: string; status?: string; order?: number; startedAt?: unknown }[],
  projectStatus?: string,
): string | undefined {
  if (loops.length === 0) return projectStatus;
  if (loops.some((l) => l.status === "running")) return "running";
  const latest = [...loops].sort(newestFirst)[0];
  return latest?.status ?? projectStatus;
}

/** Hook arg for a selectable loop: undefined for main (project-direct), else its id. */
export function loopArgFor(loop: SelectableLoop | undefined): string | undefined {
  return !loop || loop.isMain ? undefined : loop.id;
}
