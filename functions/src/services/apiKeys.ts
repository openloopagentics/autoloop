import { FieldValue } from "firebase-admin/firestore";
import type { Timestamp } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { generateKey, hashKey, keyDisplayPrefix } from "../apiKeys.js";

export interface KeySummary {
  id: string;
  label: string;
  prefix: string;
  createdAt: Timestamp;
}

export async function mintKey(uid: string, label: string): Promise<KeySummary & { key: string }> {
  const key = generateKey();
  const id = hashKey(key);
  const ref = db().doc(`apiKeys/${id}`);
  await ref.set({ uid, label, prefix: keyDisplayPrefix(key), createdAt: FieldValue.serverTimestamp() });
  const data = (await ref.get()).data()!;
  return { id, key, label, prefix: data.prefix, createdAt: data.createdAt };
}

export async function listKeys(uid: string): Promise<KeySummary[]> {
  const q = await db().collection("apiKeys").where("uid", "==", uid).get();
  return q.docs.map((d) => {
    const x = d.data();
    return { id: d.id, label: x.label, prefix: x.prefix, createdAt: x.createdAt };
  });
}

export async function revokeKey(uid: string, id: string): Promise<void> {
  const ref = db().doc(`apiKeys/${id}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data()!.uid !== uid) {
    throw new AppError(404, "not_found", "key not found");
  }
  await ref.delete();
}
