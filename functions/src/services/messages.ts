import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { resolveBase } from "./baseRef.js";
import { ulid } from "../ulid.js";

export async function createMessage(
  teamId: string,
  slug: string,
  text: string,
  author: "user" | "agent",
  uid: string,
): Promise<string> {
  const { baseRef } = await resolveBase(teamId, slug); // project-level (no loopId)
  const id = ulid();
  const data: Record<string, unknown> = {
    text,
    author,
    by: uid,
    createdAt: FieldValue.serverTimestamp(),
  };
  if (author === "user") data.status = "pending";
  await baseRef.collection("messages").doc(id).set(data);
  return id;
}

export interface MessagePreview {
  id: string;
  text: string;
  createdAt: string | null;
}

export async function listPendingUserMessages(
  teamId: string,
  slug: string,
  max = 50,
): Promise<MessagePreview[]> {
  const { baseRef } = await resolveBase(teamId, slug);
  const snap = await baseRef
    .collection("messages")
    .where("author", "==", "user")
    .where("status", "==", "pending")
    .orderBy("__name__")
    .limit(max)
    .get();
  return snap.docs.map((d) => {
    const v = d.data();
    const ts = v.createdAt as { toDate?: () => Date } | undefined;
    return {
      id: d.id,
      text: v.text as string,
      createdAt: ts?.toDate ? ts.toDate().toISOString() : null,
    };
  });
}

export async function ackMessage(
  teamId: string,
  slug: string,
  id: string,
  uid: string,
): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug);
  const ref = baseRef.collection("messages").doc(id);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "not_found", "message does not exist");
    if (snap.data()!.status === "delivered") return; // idempotent
    tx.set(
      ref,
      { status: "delivered", deliveredAt: FieldValue.serverTimestamp(), ackedBy: uid },
      { merge: true },
    );
  });
}
