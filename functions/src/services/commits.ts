import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { CommitBody } from "../schemas.js";

export async function upsertCommit(
  slug: string,
  phaseId: string,
  sha: string,
  body: CommitBody,
): Promise<void> {
  const phaseRef = db().doc(`projects/${slug}/phases/${phaseId}`);
  const commitRef = phaseRef.collection("commits").doc(sha);

  await db().runTransaction(async (tx) => {
    const phaseSnap = await tx.get(phaseRef);
    if (!phaseSnap.exists) throw new AppError(404, "not_found", "project or phase does not exist");

    const commitSnap = await tx.get(commitRef);
    const creating = !commitSnap.exists;
    // message and author are ALWAYS required on a commit write (spec: a commit is
    // not a partial update — every write carries its content). sha is the doc ID.
    if (body.message === undefined || body.author === undefined) {
      throw new AppError(400, "validation", "message and author are required");
    }

    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (creating) data.createdAt = FieldValue.serverTimestamp();
    data.message = body.message;
    data.author = body.author;
    if (body.url !== undefined) data.url = body.url;
    if (body.committedAt !== undefined && body.committedAt !== null) {
      data.committedAt = Timestamp.fromDate(new Date(body.committedAt));
    }

    tx.set(commitRef, data, { merge: true });
    // bump phase updatedAt so listeners see activity
    tx.set(phaseRef, { updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
