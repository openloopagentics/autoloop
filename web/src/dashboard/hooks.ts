import { useEffect, useState } from "react";
import {
  collection, collectionGroup, doc, onSnapshot, orderBy, query, where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import type { Commit, Phase, Project, Team, TeamRef } from "./types";

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
