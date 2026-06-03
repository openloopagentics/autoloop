import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { ProjectBody } from "../schemas.js";

type Tx = FirebaseFirestore.Transaction;
type Ref = FirebaseFirestore.DocumentReference;

/** Apply a project upsert within an OPEN transaction. Reads teamRef + ref before any write.
 *  Stamps visionOwner only when `owner` is provided (a bare project set does not stamp). */
export async function applyProjectUpsert(tx: Tx, teamRef: Ref, ref: Ref, slug: string, body: ProjectBody, owner?: "web" | "loop"): Promise<void> {
  const teamSnap = await tx.get(teamRef);
  if (!teamSnap.exists) throw new AppError(404, "not_found", "team does not exist");
  const snap = await tx.get(ref);
  const creating = !snap.exists;
  if (creating && (!body.title || !body.status)) {
    throw new AppError(400, "validation", "title and status are required when creating a project");
  }
  const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (creating) { data.slug = slug; data.createdAt = FieldValue.serverTimestamp(); data.currentPhaseId = null; }
  if (body.title !== undefined) data.title = body.title;
  if (body.status !== undefined) data.status = body.status;
  if (body.design !== undefined) data.design = { ...body.design, updatedAt: FieldValue.serverTimestamp() };
  if (owner !== undefined) data.visionOwner = owner;
  tx.set(ref, data, { merge: true });
}

export async function upsertProject(teamId: string, slug: string, body: ProjectBody): Promise<void> {
  const teamRef = db().doc(`teams/${teamId}`);
  const ref = db().doc(`teams/${teamId}/projects/${slug}`);
  await db().runTransaction((tx) => applyProjectUpsert(tx, teamRef, ref, slug, body)); // owner undefined: bare project set doesn't stamp
}
