import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { resolveBase } from "./baseRef.js";
import { ulid } from "../ulid.js";
import type { CommentBody } from "../schemas.js";

// Steering comments live in a flat project-level collection and intentionally survive
// page deletion (see services/pages.ts deletePage). Project-direct only — a comment
// belongs to the project, not a single loop.

// The three terminal-or-open states a comment can hold. The agent's ?status= filter is
// whitelisted against this set in routes/comments.ts.
export const COMMENT_STATUSES = ["open", "resolved", "declined"] as const;

// A single thread must not grow unbounded: Firestore caps a doc at 1MB, and without a
// guard a busy comment would eventually fail with a raw 500. Cap it well below that.
const MAX_THREAD_ENTRIES = 100;

/** User creates an open steering comment anchored to a wiki page. Returns the ULID id. */
export async function createComment(
  teamId: string,
  slug: string,
  body: CommentBody,
  author: string,
): Promise<string> {
  const { baseRef } = await resolveBase(teamId, slug); // project-level (404s on a missing project)
  const id = ulid();
  const data: Record<string, unknown> = {
    pageId: body.pageId,
    anchor: body.anchor,
    body: body.body,
    severity: body.severity,
    author,
    status: "open",
    thread: [],
    createdAt: FieldValue.serverTimestamp(),
  };
  if (body.targetScenarioId !== undefined) data.targetScenarioId = body.targetScenarioId;
  await baseRef.collection("comments").doc(id).set(data);
  return id;
}

/**
 * Full comment docs, optionally filtered by status, ULID/doc-id ordered (oldest first).
 * Results are truncated at MAX_LIST — the loop contract is "every open comment gets
 * triaged", so if a project ever exceeds this the tail is silently dropped and the loop
 * must resolve some before the rest surface. Kept generous; raise it if that bites.
 */
const MAX_LIST = 200;
export async function listComments(
  teamId: string,
  slug: string,
  status?: string,
): Promise<Record<string, unknown>[]> {
  const { baseRef } = await resolveBase(teamId, slug);
  let q = baseRef.collection("comments").orderBy("__name__").limit(MAX_LIST) as FirebaseFirestore.Query;
  if (status) q = q.where("status", "==", status);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Agent appends an {by:agent,text,at} entry to a comment's thread. 404 if unknown.
 * Replying after a comment is resolved/declined is intentionally allowed (the agent may
 * add a follow-up note post-resolution). Rejects once the thread hits MAX_THREAD_ENTRIES.
 */
export async function replyToComment(
  teamId: string,
  slug: string,
  id: string,
  text: string,
): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug);
  const ref = baseRef.collection("comments").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError(404, "not_found", "comment does not exist");
  const thread = (snap.data()!.thread as unknown[]) ?? [];
  if (thread.length >= MAX_THREAD_ENTRIES) {
    throw new AppError(400, "validation", `comment thread is full (max ${MAX_THREAD_ENTRIES} entries)`);
  }
  await ref.update({
    thread: FieldValue.arrayUnion({ by: "agent", text, at: new Date().toISOString() }),
  });
}

/**
 * Agent resolves (or declines) a comment: sets status + resolvedAt, and appends the
 * optional note as a final agent thread entry. Already-resolved → no-op (race guard,
 * mirrors ackMessage). 404 if unknown.
 */
export async function resolveComment(
  teamId: string,
  slug: string,
  id: string,
  resolution: "resolved" | "declined",
  note: string | undefined,
): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug);
  const ref = baseRef.collection("comments").doc(id);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "not_found", "comment does not exist");
    if (snap.data()!.status !== "open") return; // idempotent — already resolved/declined
    const update: Record<string, unknown> = { status: resolution, resolvedAt: FieldValue.serverTimestamp() };
    if (note !== undefined) {
      update.thread = FieldValue.arrayUnion({ by: "agent", text: note, at: new Date().toISOString() });
    }
    tx.set(ref, update, { merge: true });
  });
}

/**
 * User accepts a blocking comment's resolution (acceptance is separate from resolution).
 * Only meaningful for blocking comments (advisory → 400). Allowed if the requester is the
 * author OR an owner/admin of the team; otherwise 403. 404 if unknown. Idempotent — a
 * second accept is a no-op that preserves the first acceptor's audit trail.
 */
export async function acceptComment(
  teamId: string,
  slug: string,
  id: string,
  uid: string,
): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug);
  const ref = baseRef.collection("comments").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError(404, "not_found", "comment does not exist");
  const data = snap.data()!;
  if (data.severity !== "blocking") throw new AppError(400, "validation", "only blocking comments can be accepted");
  if (data.accepted === true) return; // already accepted — keep the first acceptedBy
  // Fetch the requester's team role (same mechanics as the project-delete handler).
  const role = (await db().doc(`teams/${teamId}/members/${uid}`).get()).data()?.role;
  const authorized = uid === data.author || role === "owner" || role === "admin";
  if (!authorized) throw new AppError(403, "forbidden", "only the author or a team owner/admin can accept");
  await ref.update({ accepted: true, acceptedBy: uid });
}
