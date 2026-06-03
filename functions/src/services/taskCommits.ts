import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { CommitBody } from "../schemas.js";

export async function upsertTaskCommit(
  teamId: string, slug: string, taskId: string, sha: string, body: CommitBody,
): Promise<void> {
  const taskRef = db().doc(`teams/${teamId}/projects/${slug}/tasks/${taskId}`);
  const commitRef = taskRef.collection("commits").doc(sha);
  await db().runTransaction(async (tx) => {
    const taskSnap = await tx.get(taskRef);
    if (!taskSnap.exists) throw new AppError(404, "not_found", "project or task does not exist");
    const commitSnap = await tx.get(commitRef);
    if (body.message === undefined || body.author === undefined) {
      throw new AppError(400, "validation", "message and author are required");
    }
    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (!commitSnap.exists) data.createdAt = FieldValue.serverTimestamp();
    data.message = body.message;
    data.author = body.author;
    if (body.url !== undefined) data.url = body.url;
    if (body.committedAt !== undefined && body.committedAt !== null) {
      data.committedAt = Timestamp.fromDate(new Date(body.committedAt));
    }
    tx.set(commitRef, data, { merge: true });
    tx.set(taskRef, { updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
