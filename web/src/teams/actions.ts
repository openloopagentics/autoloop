import {
  doc, setDoc, addDoc, deleteDoc, updateDoc, collection, serverTimestamp, writeBatch,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import type { Invite, Role } from "./types";

/** Current signed-in user's uid, or throw a clear error. */
function requireUid(): string {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  return user.uid;
}

/** Bootstrap: create the team, then (sequential) the creator's own owner member. */
export async function createTeam(teamId: string, name: string): Promise<void> {
  const uid = requireUid();
  const email = auth.currentUser?.email?.toLowerCase() ?? null;
  await setDoc(doc(db, "teams", teamId), { name, createdBy: uid, createdAt: serverTimestamp() });
  await setDoc(doc(db, "teams", teamId, "members", uid), {
    uid, role: "owner", email, inviteId: null, joinedAt: serverTimestamp(),
  });
}

export async function inviteMember(teamId: string, email: string, role: Role): Promise<void> {
  await addDoc(collection(db, "teams", teamId, "invites"), {
    email: email.toLowerCase(), role, invitedBy: requireUid(), status: "pending", createdAt: serverTimestamp(),
  });
}

export async function revokeInvite(teamId: string, inviteId: string): Promise<void> {
  await deleteDoc(doc(db, "teams", teamId, "invites", inviteId));
}

/** Atomic accept: create own member (carrying inviteId) + delete the invite. */
export async function acceptInvite(invite: Invite): Promise<void> {
  const uid = requireUid();
  const teamId = invite.teamId;
  if (!teamId) throw new Error("Invite is missing a team");
  const batch = writeBatch(db);
  batch.set(doc(db, "teams", teamId, "members", uid), {
    uid, role: invite.role, email: invite.email.toLowerCase(), inviteId: invite.id, joinedAt: serverTimestamp(),
  });
  batch.delete(doc(db, "teams", teamId, "invites", invite.id));
  await batch.commit();
}

export async function declineInvite(invite: Invite): Promise<void> {
  if (!invite.teamId) throw new Error("Invite is missing a team");
  await deleteDoc(doc(db, "teams", invite.teamId, "invites", invite.id));
}

export async function changeRole(teamId: string, uid: string, role: Role): Promise<void> {
  await updateDoc(doc(db, "teams", teamId, "members", uid), { role });
}

export async function removeMember(teamId: string, uid: string): Promise<void> {
  await deleteDoc(doc(db, "teams", teamId, "members", uid));
}
