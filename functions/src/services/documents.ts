import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { assertWebEditable } from "./visionOwner.js";
import type { DocumentBody } from "../schemas.js";

type Tx = FirebaseFirestore.Transaction;
type Ref = FirebaseFirestore.DocumentReference;

/** Apply a document upsert within an OPEN transaction (project already read/validated by caller).
 *  Stamps the project's visionOwner to `owner`. Reads docRef before any write. */
export async function applyDocumentUpsert(tx: Tx, projectRef: Ref, ref: Ref, body: DocumentBody, owner: "web" | "loop"): Promise<void> {
  const snap = await tx.get(ref);
  if (!snap.exists && (body.kind === undefined || body.title === undefined || body.format === undefined || body.content === undefined)) {
    throw new AppError(400, "validation", "kind, title, format and content are required when creating a document");
  }
  const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (!snap.exists) data.createdAt = FieldValue.serverTimestamp();
  if (body.kind !== undefined) data.kind = body.kind;
  if (body.title !== undefined) data.title = body.title;
  if (body.format !== undefined) data.format = body.format;
  if (body.content !== undefined) data.content = body.content;
  tx.set(ref, data, { merge: true });
  tx.set(projectRef, { visionOwner: owner, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Agent path: open a transaction, require the project, apply with owner "loop". */
export async function upsertDocument(teamId: string, slug: string, docId: string, body: DocumentBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const ref = projectRef.collection("documents").doc(docId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    await applyDocumentUpsert(tx, projectRef, ref, body, "loop");
  });
}

/** Web/delete path: delete a document; caller guards web-editability. */
export async function deleteDocument(teamId: string, slug: string, docId: string): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const ref = projectRef.collection("documents").doc(docId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    assertWebEditable(projectSnap);
    tx.delete(ref);
  });
}
