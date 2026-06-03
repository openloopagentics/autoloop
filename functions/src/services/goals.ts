import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { GoalBody } from "../schemas.js";

export async function upsertGoal(teamId: string, slug: string, goalId: string, body: GoalBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const goalRef = projectRef.collection("goals").doc(goalId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
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
  });
}
