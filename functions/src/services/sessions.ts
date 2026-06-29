import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { clampLimit } from "../pagination.js";
import type { SessionBody } from "../schemas.js";

async function requireProject(teamId: string, slug: string) {
  const ref = db().doc(`teams/${teamId}/projects/${slug}`);
  if (!(await ref.get()).exists) throw new AppError(404, "not_found", "project does not exist");
  return ref;
}

// Keep the most-recent N entries to stay under Firestore's 1 MB doc limit (~500 B/entry).
const MAX_ENTRIES = 1500;

export async function appendSession(teamId: string, slug: string, loopId: string, body: SessionBody): Promise<void> {
  const projectRef = await requireProject(teamId, slug);
  // Write directly under the loop path without requiring the loop doc to exist —
  // session logs are observability; the loop may not yet be registered in Firestore.
  const docRef = projectRef.collection("loops").doc(loopId).collection("sessions").doc(body.sessionId);
  // APPEND the delta entries to whatever's already stored (clients send only new entries
  // since their last push). Transactional read-modify-write avoids races between rapid pushes.
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const prev = snap.exists ? ((snap.data()!.entries as unknown[]) ?? []) : [];
    const merged = prev.concat(body.entries).slice(-MAX_ENTRIES);
    const startedAt = snap.exists ? (snap.data()!.startedAt ?? body.startedAt) : body.startedAt;
    tx.set(docRef, {
      sessionId: body.sessionId,
      startedAt,
      endedAt: body.endedAt,
      entries: merged,
    });
  });
}

export async function listSessions(teamId: string, slug: string, loopId: string, limit?: number) {
  const projectRef = await requireProject(teamId, slug);
  // Hard-cap the read so an unbounded sessions collection can't blow the response budget.
  const snap = await projectRef.collection("loops").doc(loopId).collection("sessions")
    .orderBy("startedAt").limit(clampLimit(limit)).get();
  return snap.docs.map((d) => d.data());
}
