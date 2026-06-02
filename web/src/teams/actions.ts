import {
  doc, setDoc, addDoc, deleteDoc, updateDoc, collection, serverTimestamp, writeBatch,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import type { Invite, Role } from "./types";

/** Bootstrap: create the team, then (sequential) the creator's own owner member. */
export async function createTeam(teamId: string, name: string): Promise<void> {
  const uid = auth.currentUser!.uid;
  const email = auth.currentUser?.email?.toLowerCase() ?? null;
  await setDoc(doc(db, "teams", teamId), { name, createdBy: uid, createdAt: serverTimestamp() });
  await setDoc(doc(db, "teams", teamId, "members", uid), {
    uid, role: "owner", email, inviteId: null, joinedAt: serverTimestamp(),
  });
}

export async function inviteMember(teamId: string, email: string, role: Role): Promise<void> {
  await addDoc(collection(db, "teams", teamId, "invites"), {
    email: email.toLowerCase(), role, invitedBy: auth.currentUser!.uid, status: "pending", createdAt: serverTimestamp(),
  });
}

export async function revokeInvite(teamId: string, inviteId: string): Promise<void> {
  await deleteDoc(doc(db, "teams", teamId, "invites", inviteId));
}

/** Atomic accept: create own member (carrying inviteId) + delete the invite. */
export async function acceptInvite(invite: Invite): Promise<void> {
  const uid = auth.currentUser!.uid;
  const teamId = invite.teamId!;
  const batch = writeBatch(db);
  batch.set(doc(db, "teams", teamId, "members", uid), {
    uid, role: invite.role, email: invite.email.toLowerCase(), inviteId: invite.id, joinedAt: serverTimestamp(),
  });
  batch.delete(doc(db, "teams", teamId, "invites", invite.id));
  await batch.commit();
}

export async function declineInvite(invite: Invite): Promise<void> {
  await deleteDoc(doc(db, "teams", invite.teamId!, "invites", invite.id));
}

export async function changeRole(teamId: string, uid: string, role: Role): Promise<void> {
  await updateDoc(doc(db, "teams", teamId, "members", uid), { role });
}

export async function removeMember(teamId: string, uid: string): Promise<void> {
  await deleteDoc(doc(db, "teams", teamId, "members", uid));
}
