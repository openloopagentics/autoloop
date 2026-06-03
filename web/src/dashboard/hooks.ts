import { useEffect, useState } from "react";
import {
  collection, collectionGroup, doc, documentId, limit, onSnapshot, orderBy, query, where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import type { Notification } from "../notifications/types";
import type { Commit, DocumentRec, Goal, Phase, Project, Revision, Scenario, Score, Task, Team, TeamRef, TestRun } from "./types";

interface Result<T> { data: T; loading: boolean; error: string | null; }

export function useMyTeams(): Result<TeamRef[]> {
  const [data, setData] = useState<TeamRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    const q = query(collectionGroup(db, "members"), where("uid", "==", uid));
    return onSnapshot(q,
      (snap) => {
        setData(snap.docs.map((d) => ({ teamId: d.ref.parent.parent?.id ?? "", role: d.data().role })).filter((t) => t.teamId));
        setLoading(false);
      },
      (e) => { setError(e.message); setLoading(false); });
  }, []);
  return { data, loading, error };
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
  const [data, setData] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    return onSnapshot(collection(db, "teams", teamId, "projects"),
      (snap) => { setData(snap.docs.map((d) => ({ slug: d.id, ...(d.data() as object) })) as Project[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId]);
  return { data, loading, error };
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

export function usePhases(teamId: string, slug: string): Result<Phase[]> {
  const [data, setData] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "phases"), orderBy("order"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Phase[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function useCommits(teamId: string, slug: string, phaseId: string): Result<Commit[]> {
  const [data, setData] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "phases", phaseId, "commits"), orderBy("createdAt", "desc"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ sha: d.id, ...(d.data() as object) })) as Commit[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug, phaseId]);
  return { data, loading, error };
}

export function useGoals(teamId: string, slug: string): Result<Goal[]> {
  const [data, setData] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "goals"), orderBy("order"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Goal[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function useScenarios(teamId: string, slug: string): Result<Scenario[]> {
  const [data, setData] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "scenarios"), orderBy("order"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Scenario[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function useTasks(teamId: string, slug: string): Result<Task[]> {
  const [data, setData] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "tasks"), orderBy("order"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Task[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function useScores(teamId: string, slug: string): Result<Score[]> {
  const [data, setData] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "scores"), orderBy(documentId()));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Score[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function useTestRuns(teamId: string, slug: string): Result<TestRun[]> {
  const [data, setData] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "testRuns"), orderBy(documentId()));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as TestRun[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function useRevisions(teamId: string, slug: string): Result<Revision[]> {
  const [data, setData] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "revisions"), orderBy(documentId()));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Revision[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function useDocuments(teamId: string, slug: string): Result<DocumentRec[]> {
  const [data, setData] = useState<DocumentRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "documents"), orderBy(documentId()));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DocumentRec[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug]);
  return { data, loading, error };
}

export function useTeamNotifications(teamId: string): Result<Notification[]> {
  const [data, setData] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "notifications"), orderBy(documentId(), "desc"), limit(50));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, teamId, ...(d.data() as object) })) as Notification[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId]);
  return { data, loading, error };
}

export function useTaskCommits(teamId: string, slug: string, taskId: string): Result<Commit[]> {
  const [data, setData] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "teams", teamId, "projects", slug, "tasks", taskId, "commits"), orderBy("createdAt", "desc"));
    return onSnapshot(q,
      (snap) => { setData(snap.docs.map((d) => ({ sha: d.id, ...(d.data() as object) })) as Commit[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId, slug, taskId]);
  return { data, loading, error };
}
