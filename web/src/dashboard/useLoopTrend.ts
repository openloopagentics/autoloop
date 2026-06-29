import { useEffect, useRef, useState } from "react";
import { collection, documentId, getDocs, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { basePath, MAIN_ID } from "./loopView";
import { useLoops } from "./hooks";
import { trendWindow, type LoopRunData } from "./trendView";
import type { Bug, Commit, Score, Task, TestRun, Verification } from "./types";

interface Slice { scores?: Score[]; testRuns?: TestRun[]; bugs?: Bug[]; tasks?: Task[]; taskCommits?: Commit[]; verifications?: Verification[]; }

/** The 5 flat run-data collections listened to per loop (5 × ≤20 listeners). */
const FLAT_COLLECTIONS = ["scores", "testRuns", "bugs", "tasks", "verifications"] as const;

/**
 * Run data for the most recent TREND_LOOPS_MAX loops (incl. the implicit `main` when
 * includeMain — pass ProjectDetail's hasProjectDirectData). Flat collections are live
 * listeners; task COMMITS (nested under tasks/{id}/commits, the only place tokens are
 * persisted) are one-shot getDocs reads re-fetched when a loop's tasks snapshot changes
 * — trends don't need realtime token movement. Loading until every loop's 5 flat
 * slices have arrived. Exported as the trend data layer (reused by the product map).
 */
export function useLoopTrend(teamId: string, slug: string, includeMain: boolean):
  { data: LoopRunData[]; loading: boolean; error: string | null } {
  const { data: loops, loading: loopsLoading, error: loopsError } = useLoops(teamId, slug);
  // Deliberate deviation from plan: renamed `window` → `win` to avoid shadowing the global `window`.
  const win = trendWindow(loops, includeMain);
  const loopKey = win.map((l) => l.id).join(",");
  const [byScope, setByScope] = useState<Record<string, Slice>>({});
  const [error, setError] = useState<string | null>(null);

  // Live listeners: 4 flat collections per loop in the window. `main` maps to the
  // project-direct base via basePath(…, undefined) — the loopArgFor convention.
  useEffect(() => {
    const ids = loopKey.split(",").filter(Boolean);
    const unsubs = ids.flatMap((id) => {
      const loopArg = id === MAIN_ID ? undefined : id;
      return FLAT_COLLECTIONS.map((coll) =>
        onSnapshot(query(collection(db, ...basePath(teamId, slug, loopArg), coll), orderBy(documentId())),
          (snap) => {
            const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
            // Cast needed for strict tsc: computed key from `coll` (const union) must satisfy Slice.
            setByScope((prev) => ({ ...prev, [id]: { ...prev[id], [coll]: docs as Slice[typeof coll] } }));
          },
          (e) => setError(e.message)));
    });
    return () => unsubs.forEach((u) => u());
  }, [teamId, slug, loopKey]);

  // One-shot task-commit reads, keyed on each loop's tasks snapshot (task-id sets):
  // re-fetched when tasks change, NOT live — bounds listener count at 20 × 4.
  const byScopeRef = useRef(byScope);
  byScopeRef.current = byScope;
  const tasksKey = win.map((l) => `${l.id}:${(byScope[l.id]?.tasks ?? []).map((t) => t.id).join("+")}`).join("|");
  useEffect(() => {
    let cancelled = false;
    for (const part of tasksKey.split("|").filter(Boolean)) {
      const id = part.slice(0, part.indexOf(":"));
      const loopArg = id === MAIN_ID ? undefined : id;
      const tasks = byScopeRef.current[id]?.tasks ?? [];
      Promise.all(tasks.map(async (t) => {
        const snap = await getDocs(collection(db, ...basePath(teamId, slug, loopArg), "tasks", t.id, "commits"));
        return snap.docs.map((d) => ({ sha: d.id, ...(d.data() as object) })) as Commit[];
      })).then((perTask) => {
        if (!cancelled) setByScope((prev) => ({ ...prev, [id]: { ...prev[id], taskCommits: perTask.flat() } }));
      }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    }
    return () => { cancelled = true; };
  }, [teamId, slug, tasksKey]);

  // Assemble in window order; only current scopes are read (a removed loop's stale
  // slice lingers in state but is never emitted — same stance as useAllScores).
  const ready = (id: string) => FLAT_COLLECTIONS.every((c) => byScope[id]?.[c] !== undefined);
  const loading = loopsLoading || win.some((l) => !ready(l.id));
  const data: LoopRunData[] = win.map((l) => ({
    loop: l,
    scores: byScope[l.id]?.scores ?? [],
    testRuns: byScope[l.id]?.testRuns ?? [],
    bugs: byScope[l.id]?.bugs ?? [],
    tasks: byScope[l.id]?.tasks ?? [],
    taskCommits: byScope[l.id]?.taskCommits ?? [],
    verifications: byScope[l.id]?.verifications ?? [],
  }));
  return { data, loading, error: loopsError || error };
}
