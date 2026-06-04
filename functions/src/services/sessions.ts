import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { SessionBody } from "../schemas.js";

async function requireProject(teamId: string, slug: string) {
  const ref = db().doc(`teams/${teamId}/projects/${slug}`);
  if (!(await ref.get()).exists) throw new AppError(404, "not_found", "project does not exist");
  return ref;
}

export async function appendSession(teamId: string, slug: string, loopId: string, body: SessionBody): Promise<void> {
  const projectRef = await requireProject(teamId, slug);
  // Write directly under the loop path without requiring the loop doc to exist —
  // session logs are observability; the loop may not yet be registered in Firestore.
  await projectRef.collection("loops").doc(loopId).collection("sessions").doc(body.sessionId).set({
    sessionId: body.sessionId,
    startedAt: body.startedAt,
    endedAt: body.endedAt,
    entries: body.entries,
  });
}

export async function listSessions(teamId: string, slug: string, loopId: string) {
  const projectRef = await requireProject(teamId, slug);
  const snap = await projectRef.collection("loops").doc(loopId).collection("sessions").orderBy("startedAt").get();
  return snap.docs.map((d) => d.data());
}
