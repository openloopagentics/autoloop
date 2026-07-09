import { useEffect, useState } from "react";
import {
  collection, collectionGroup, doc, documentId, limit, onSnapshot, orderBy, query, where,
  type Query, type QuerySnapshot,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import type { Notification } from "../notifications/types";
import { basePath } from "./loopView";
import type { Bug, Commit, Decision, DocumentRec, Goal, Idea, Loop, Message, Page, PageComment, Phase, Project, Revision, Scenario, Score, SessionDoc, Task, Team, TeamRef, TestRun, Verification, VisionChange } from "./types";

interface Result<T> { data: T; loading: boolean; error: string | null; }

/**
 * Generic Firestore collection-query subscription. Removes the loading/error/data
 * boilerplate repeated across the single-query hooks below.
 *
 * - `makeQuery` builds the query from the current deps; return `null` to skip the
 *   subscription (e.g. missing ids), in which case data resets to `initial`.
 * - `parse` maps a snapshot to the hook's data shape.
 * - Subscribes WITH an error callback so listener errors surface in `error` rather
 *   than silently leaving stale data; cleans up on unmount and re-subscribes on dep change.
 */
function useFirestoreQuery<T>(
  makeQuery: () => Query | null,
  parse: (snap: QuerySnapshot) => T,
  initial: T,
  deps: unknown[],
): Result<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = makeQuery();
    if (!q) { setData(initial); setLoading(false); return; }
    setLoading(true);
    setError(null);
    return onSnapshot(q,
      (snap) => { setData(parse(snap)); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, error };
}

export function useMyTeams(): Result<TeamRef[]> {
  return useFirestoreQuery<TeamRef[]>(
    () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return null;
      return query(collectionGroup(db, "members"), where("uid", "==", uid));
    },
    (snap) => snap.docs.map((d) => ({ teamId: d.ref.parent.parent?.id ?? "", role: d.data().role })).filter((t) => t.teamId),
    [],
    [],
  );
}

export function useTeam(teamId: string): Result<Team | null> {
  const [data, setData] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    return onSnapshot(doc(db, "teams", teamId),
      (snap) => { setData(snap.exists() ? (snap.data() as Team) : null); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId]);
  return { data, loading, error };
}

export function useTeamProjects(teamId: string): Result<Project[]> {
  return useFirestoreQuery<Project[]>(
    () => collection(db, "teams", teamId, "projects"),
    (snap) => snap.docs.map((d) => ({ slug: d.id, ...(d.data() as object) })) as Project[],
    [],
    [teamId],
  );
}

export function useProject(teamId: string, slug: string): Result<Project | null | undefined> {
  const [data, setData] = useState<Project | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    return onSnapshot(doc(db, "teams", teamId, "projects", slug),
      (snap) => { setData(snap.exists() ? ({ slug: snap.id, ...(snap.data() as object) } as Project) : null); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function usePhases(teamId: string, slug: string, loopId?: string): Result<Phase[]> {
  return useFirestoreQuery<Phase[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "phases"), orderBy("order")),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Phase[],
    [],
    [teamId, slug, loopId],
  );
}

export function useCommits(teamId: string, slug: string, phaseId: string, loopId?: string): Result<Commit[]> {
  return useFirestoreQuery<Commit[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "phases", phaseId, "commits"), orderBy("createdAt", "desc")),
    (snap) => snap.docs.map((d) => ({ sha: d.id, ...(d.data() as object) })) as Commit[],
    [],
    [teamId, slug, phaseId, loopId],
  );
}

export function useGoals(teamId: string, slug: string): Result<Goal[]> {
  return useFirestoreQuery<Goal[]>(
    () => query(collection(db, "teams", teamId, "projects", slug, "goals"), orderBy("order")),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Goal[],
    [],
    [teamId, slug],
  );
}

export function useScenarios(teamId: string, slug: string): Result<Scenario[]> {
  return useFirestoreQuery<Scenario[]>(
    () => query(collection(db, "teams", teamId, "projects", slug, "scenarios"), orderBy("order")),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Scenario[],
    [],
    [teamId, slug],
  );
}

export function useTasks(teamId: string, slug: string, loopId?: string): Result<Task[]> {
  return useFirestoreQuery<Task[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "tasks"), orderBy("order")),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Task[],
    [],
    [teamId, slug, loopId],
  );
}

export function useScores(teamId: string, slug: string, loopId?: string): Result<Score[]> {
  return useFirestoreQuery<Score[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "scores"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Score[],
    [],
    [teamId, slug, loopId],
  );
}

export function useTestRuns(teamId: string, slug: string, loopId?: string): Result<TestRun[]> {
  return useFirestoreQuery<TestRun[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "testRuns"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as TestRun[],
    [],
    [teamId, slug, loopId],
  );
}

export function useVerifications(teamId: string, slug: string, loopId?: string): Result<Verification[]> {
  return useFirestoreQuery<Verification[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "verifications"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Verification[],
    [],
    [teamId, slug, loopId],
  );
}

export function useRevisions(teamId: string, slug: string, loopId?: string): Result<Revision[]> {
  return useFirestoreQuery<Revision[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "revisions"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Revision[],
    [],
    [teamId, slug, loopId],
  );
}

export function useDecisions(teamId: string, slug: string, loopId?: string): Result<Decision[]> {
  return useFirestoreQuery<Decision[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "decisions"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Decision[],
    [],
    [teamId, slug, loopId],
  );
}

export function useDocuments(teamId: string, slug: string): Result<DocumentRec[]> {
  return useFirestoreQuery<DocumentRec[]>(
    () => query(collection(db, "teams", teamId, "projects", slug, "documents"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DocumentRec[],
    [],
    [teamId, slug],
  );
}

export function useTeamNotifications(teamId: string): Result<Notification[]> {
  return useFirestoreQuery<Notification[]>(
    () => query(collection(db, "teams", teamId, "notifications"), orderBy(documentId(), "desc"), limit(50)),
    (snap) => snap.docs.map((d) => ({ id: d.id, teamId, ...(d.data() as object) })) as Notification[],
    [],
    [teamId],
  );
}

export function useTaskCommits(teamId: string, slug: string, taskId: string, loopId?: string): Result<Commit[]> {
  return useFirestoreQuery<Commit[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "tasks", taskId, "commits"), orderBy("createdAt", "desc")),
    (snap) => snap.docs.map((d) => ({ sha: d.id, ...(d.data() as object) })) as Commit[],
    [],
    [teamId, slug, taskId, loopId],
  );
}

export function useLoops(teamId: string, slug: string): Result<Loop[]> {
  return useFirestoreQuery<Loop[]>(
    () => (teamId && slug) ? query(collection(db, "teams", teamId, "projects", slug, "loops"), orderBy("order")) : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Loop[],
    [],
    [teamId, slug],
  );
}

export function useBugs(teamId: string, slug: string, loopId?: string): Result<Bug[]> {
  return useFirestoreQuery<Bug[]>(
    () => query(collection(db, ...basePath(teamId, slug, loopId), "bugs"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Bug[],
    [],
    [teamId, slug, loopId],
  );
}

/** All test runs across the whole project — project-direct + every loop's testRuns, merged. */
export function useAllTestRuns(teamId: string, slug: string): Result<TestRun[]> {
  const { data: loops } = useLoops(teamId, slug);
  const loopKey = loops.map((l) => l.id).join(",");
  const [byScope, setByScope] = useState<Record<string, TestRun[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const scopes: (string | undefined)[] = [undefined, ...loopKey.split(",").filter(Boolean)];
    const unsubs = scopes.map((loopId) => {
      const scopeKey = loopId ?? "__main__";
      const q = query(collection(db, ...basePath(teamId, slug, loopId), "testRuns"), orderBy(documentId()));
      return onSnapshot(q,
        (snap) => {
          setByScope((prev) => ({ ...prev, [scopeKey]: snap.docs.map((d) => ({ id: d.id, loopId, ...(d.data() as object) })) as TestRun[] }));
          setLoading(false);
        },
        (e) => { setError(e.message); setLoading(false); });
    });
    return () => unsubs.forEach((u) => u());
  }, [teamId, slug, loopKey]);
  const current = new Set(["__main__", ...loopKey.split(",").filter(Boolean)]);
  const data = Object.entries(byScope).filter(([k]) => current.has(k)).flatMap(([, v]) => v);
  return { data, loading, error };
}

/** All scores across the whole project — project-direct + every loop's scores, merged.
 *  Scenarios are project-level vision, so their met-state should reflect the latest
 *  score/test-run in ANY iteration, not just the loop currently being viewed. */
export function useAllScores(teamId: string, slug: string): Result<Score[]> {
  const { data: loops } = useLoops(teamId, slug);
  const loopKey = loops.map((l) => l.id).join(",");
  const [byScope, setByScope] = useState<Record<string, Score[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const scopes: (string | undefined)[] = [undefined, ...loopKey.split(",").filter(Boolean)];
    const unsubs = scopes.map((loopId) => {
      const scopeKey = loopId ?? "__main__";
      const q = query(collection(db, ...basePath(teamId, slug, loopId), "scores"), orderBy(documentId()));
      return onSnapshot(q,
        (snap) => {
          setByScope((prev) => ({ ...prev, [scopeKey]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Score[] }));
          setLoading(false);
        },
        (e) => { setError(e.message); setLoading(false); });
    });
    return () => unsubs.forEach((u) => u());
  }, [teamId, slug, loopKey]);
  const current = new Set(["__main__", ...loopKey.split(",").filter(Boolean)]);
  const data = Object.entries(byScope).filter(([k]) => current.has(k)).flatMap(([, v]) => v);
  return { data, loading, error };
}

/** All bugs across the whole project — project-direct + every loop's bugs, merged. */
export function useAllBugs(teamId: string, slug: string): Result<Bug[]> {
  const { data: loops } = useLoops(teamId, slug);
  const loopKey = loops.map((l) => l.id).join(",");
  const [byScope, setByScope] = useState<Record<string, Bug[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const scopes: (string | undefined)[] = [undefined, ...loopKey.split(",").filter(Boolean)]; // project-direct + each loop
    const unsubs = scopes.map((loopId) => {
      const scopeKey = loopId ?? "__main__";
      const q = query(collection(db, ...basePath(teamId, slug, loopId), "bugs"), orderBy(documentId()));
      return onSnapshot(q,
        (snap) => {
          setByScope((prev) => ({ ...prev, [scopeKey]: snap.docs.map((d) => ({ id: d.id, loopId, ...(d.data() as object) })) as Bug[] }));
          setLoading(false);
        },
        (e) => { setError(e.message); setLoading(false); });
    });
    return () => unsubs.forEach((u) => u());
  }, [teamId, slug, loopKey]);
  // Only include scopes that are still current (a removed loop shouldn't linger).
  const current = new Set(["__main__", ...loopKey.split(",").filter(Boolean)]);
  const data = Object.entries(byScope).filter(([k]) => current.has(k)).flatMap(([, v]) => v);
  return { data, loading, error };
}

export function useMessages(teamId: string, slug: string): Result<Message[]> {
  return useFirestoreQuery<Message[]>(
    () => query(collection(db, "teams", teamId, "projects", slug, "messages"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Message[],
    [],
    [teamId, slug],
  );
}

export function useIdeas(teamId: string, slug: string): Result<Idea[]> {
  return useFirestoreQuery<Idea[]>(
    () => query(collection(db, "teams", teamId, "projects", slug, "ideas"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Idea[],
    [],
    [teamId, slug],
  );
}

export function usePages(teamId: string, slug: string): Result<Page[]> {
  return useFirestoreQuery<Page[]>(
    () => query(collection(db, "teams", teamId, "projects", slug, "pages"), orderBy("order")),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Page[],
    [],
    [teamId, slug],
  );
}

export function useComments(teamId: string, slug: string): Result<PageComment[]> {
  return useFirestoreQuery<PageComment[]>(
    () => query(collection(db, "teams", teamId, "projects", slug, "comments"), orderBy(documentId())),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as PageComment[],
    [],
    [teamId, slug],
  );
}

export function useVisionChanges(teamId: string, slug: string): Result<VisionChange[]> {
  return useFirestoreQuery<VisionChange[]>(
    () => query(collection(db, "teams", teamId, "projects", slug, "visionChanges"), orderBy(documentId(), "desc")),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as VisionChange[],
    [],
    [teamId, slug],
  );
}

export function useSessionLog(teamId: string, slug: string, loopId: string | undefined): Result<SessionDoc[]> {
  return useFirestoreQuery<SessionDoc[]>(
    () => loopId
      ? query(collection(db, "teams", teamId, "projects", slug, "loops", loopId, "sessions"), orderBy("startedAt"))
      : null,
    (snap) => snap.docs.map((d) => d.data() as SessionDoc),
    [],
    [teamId, slug, loopId],
  );
}
