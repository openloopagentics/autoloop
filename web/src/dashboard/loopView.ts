import type { Loop, Phase, Project } from "./types";
import { isTerminalStatus } from "./status";
import { tsMillis } from "./whyModelAtTime";

export const MAIN_ID = "main";

/** Newest-iteration-first comparator: STRICTLY startedAt desc (server-stamped truth),
 *  then order desc, then numeric-aware id desc. No status-based reordering — a stale
 *  loop stuck "running" must NOT outrank genuinely newer iterations. */
function newestFirst(
  a: { id: string; order?: number; startedAt?: unknown },
  b: { id: string; order?: number; startedAt?: unknown },
): number {
  return (tsMillis(b.startedAt) ?? 0) - (tsMillis(a.startedAt) ?? 0)
    || (b.order ?? 0) - (a.order ?? 0)
    || b.id.localeCompare(a.id, undefined, { numeric: true });
}

export interface SelectableLoop {
  id: string; isMain: boolean;
  goal?: string; name?: string; status?: string; order?: number;
  startedAt?: unknown; // server-stamped at loop create — shown on the row, drives ordering
  updatedAt?: unknown; // last write — drives the zombie-running → paused display rule
  currentPhaseId?: string | null; currentTaskId?: string | null;
  previewUrl?: string | null;
}

/** Firestore path segments for a (loop-scoped or project-direct) collection root. */
export function basePath(teamId: string, slug: string, loopId?: string): [string, ...string[]] {
  const base: [string, ...string[]] = ["teams", teamId, "projects", slug];
  return loopId ? [...base, "loops", loopId] : base;
}

/** Explicit loops (latest startedAt first — see newestFirst) + a synthesized `main`
 *  (always last — the oldest, pre-loop data) when the project has legacy
 *  project-direct data. `main` carries the PROJECT doc's status/phase/task. */
export function buildLoopList(loops: Loop[], project: Project | null | undefined, hasProjectDirectData: boolean, now: number = Date.now()): SelectableLoop[] {
  const list: SelectableLoop[] = [...loops]
    .sort(newestFirst)
    .map((l) => ({
      id: l.id, isMain: false, goal: l.goal, name: l.name,
      status: displayLoopStatus(l, now), // zombie running → paused (display rule)
      order: l.order,
      startedAt: l.startedAt, updatedAt: l.updatedAt,
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

export interface LoopGroup { label: string; loops: SelectableLoop[]; }

/** Group an already-newest-first loop list into loop runs by the calendar DAY each
 *  iteration started ("Today" / "Yesterday" / a date), newest run first, iterations
 *  newest-first within each run. Loops with no startedAt land in "earlier";
 *  the synthesized `main` gets its own trailing "legacy" group. */
export function groupLoopRuns(list: SelectableLoop[], now: number = Date.now()): LoopGroup[] {
  const dayKey = (ms: number) => new Date(ms).toDateString();
  const today = dayKey(now);
  const yesterday = dayKey(now - 86_400_000);
  const labelFor = (ms: number) => {
    const k = dayKey(ms);
    if (k === today) return "Today";
    if (k === yesterday) return "Yesterday";
    return new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  };
  const groups: LoopGroup[] = [];
  const at = new Map<string, LoopGroup>();
  const push = (label: string, loop: SelectableLoop) => {
    let g = at.get(label);
    if (!g) { g = { label, loops: [] }; at.set(label, g); groups.push(g); }
    g.loops.push(loop);
  };
  for (const l of list) {
    if (l.isMain) { push("legacy", l); continue; }
    const ms = tsMillis(l.startedAt);
    push(ms === null ? "earlier" : labelFor(ms), l);
  }
  return groups;
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

/** A loop still marked "running" but untouched for this long is a zombie. */
export const STALE_RUNNING_MS = 3 * 3600_000;

/** UI display status: a loop stuck "running" with no write for 3+ hours (stale pre-backstop
 *  close, dead session) renders as "paused" instead of pretending an agent is live.
 *  Pure presentation — the stored status is untouched. Staleness reads updatedAt
 *  (refreshed on every loop/derive write), falling back to startedAt. */
export function displayLoopStatus(
  loop: { status?: string; updatedAt?: unknown; startedAt?: unknown },
  now: number = Date.now(),
): string | undefined {
  if (loop.status !== "running") return loop.status;
  const last = tsMillis(loop.updatedAt) ?? tsMillis(loop.startedAt);
  return last !== null && now - last > STALE_RUNNING_MS ? "paused" : loop.status;
}

export function loopIsRunning(loop: { status?: string; updatedAt?: unknown; startedAt?: unknown }): boolean {
  return displayLoopStatus(loop) === "running";
}

/** A project's effective status. "running" only when a loop is GENUINELY running (zombies
 *  display as paused); otherwise the latest loop's display status. Falls back to the
 *  stored project status when the project has no loops. */
export function effectiveProjectStatus(
  loops: { id: string; status?: string; order?: number; startedAt?: unknown; updatedAt?: unknown }[],
  projectStatus?: string,
  now: number = Date.now(),
): string | undefined {
  if (loops.length === 0) return projectStatus;
  if (loops.some((l) => displayLoopStatus(l, now) === "running")) return "running";
  const latest = [...loops].sort(newestFirst)[0];
  return (latest ? displayLoopStatus(latest, now) : undefined) ?? projectStatus;
}

/** Hook arg for a selectable loop: undefined for main (project-direct), else its id. */
export function loopArgFor(loop: SelectableLoop | undefined): string | undefined {
  return !loop || loop.isMain ? undefined : loop.id;
}
