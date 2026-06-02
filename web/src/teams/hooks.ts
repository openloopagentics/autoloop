import { useEffect, useState } from "react";
import { collection, collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import type { Invite, Member } from "./types";

interface Result<T> { data: T; loading: boolean; error: string | null; }

export function useTeamMembers(teamId: string): Result<Member[]> {
  const [data, setData] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    return onSnapshot(collection(db, "teams", teamId, "members"),
      (snap) => { setData(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as object) })) as Member[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId]);
  return { data, loading, error };
}

export function useTeamInvites(teamId: string): Result<Invite[]> {
  const [data, setData] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    return onSnapshot(collection(db, "teams", teamId, "invites"),
      (snap) => { setData(snap.docs.map((d) => ({ id: d.id, teamId, ...(d.data() as object) })) as Invite[]); setLoading(false); },
      (e) => { setError(e.message); setLoading(false); });
  }, [teamId]);
  return { data, loading, error };
}

export function useMyPendingInvites(): Result<Invite[]> {
  const [data, setData] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const email = auth.currentUser?.email?.toLowerCase();
    if (!email) { setLoading(false); return; }
    const q = query(collectionGroup(db, "invites"), where("email", "==", email));
    return onSnapshot(q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, teamId: d.ref.parent.parent?.id, ...(d.data() as object) })) as Invite[]);
        setLoading(false);
      },
      (e) => { setError(e.message); setLoading(false); });
  }, []);
  return { data, loading, error };
}
