import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { assertWebEditable } from "./visionOwner.js";
import type { GoalBody } from "../schemas.js";

type Tx = FirebaseFirestore.Transaction;
type Ref = FirebaseFirestore.DocumentReference;

/** Apply a goal upsert within an OPEN transaction (project already read/validated by caller).
 *  Stamps the project's visionOwner to `owner`. Reads goalRef before any write. */
export async function applyGoalUpsert(tx: Tx, projectRef: Ref, goalRef: Ref, body: GoalBody, owner: "web" | "loop"): Promise<void> {
  const snap = await tx.get(goalRef);
  if (!snap.exists && body.title === undefined) {
    throw new AppError(400, "validation", "title is required when creating a goal");
  }
  const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (!snap.exists) data.createdAt = FieldValue.serverTimestamp();
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.order !== undefined) data.order = body.order;
  tx.set(goalRef, data, { merge: true });
  tx.set(projectRef, { visionOwner: owner, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Agent path: open a transaction, require the project, apply with owner "loop". */
export async function upsertGoal(teamId: string, slug: string, goalId: string, body: GoalBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const goalRef = projectRef.collection("goals").doc(goalId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    await applyGoalUpsert(tx, projectRef, goalRef, body, "loop");
  });
}

/** Web/delete path: delete a goal; caller guards web-editability. */
export async function deleteGoal(teamId: string, slug: string, goalId: string): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const goalRef = projectRef.collection("goals").doc(goalId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    assertWebEditable(projectSnap);
    tx.delete(goalRef);
  });
}
