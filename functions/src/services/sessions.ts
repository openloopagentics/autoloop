import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { SessionBody } from "../schemas.js";

async function loopRef(teamId: string, slug: string, loopId: string) {
  const ref = db().doc(`teams/${teamId}/projects/${slug}/loops/${loopId}`);
  if (!(await ref.get()).exists) throw new AppError(404, "not_found", "loop does not exist");
  return ref;
}

export async function appendSession(teamId: string, slug: string, loopId: string, body: SessionBody): Promise<void> {
  const loop = await loopRef(teamId, slug, loopId);
  await loop.collection("sessions").doc(body.sessionId).set({
    sessionId: body.sessionId,
    startedAt: body.startedAt,
    endedAt: body.endedAt,
    entries: body.entries,
  }, { merge: false });
}

export async function listSessions(teamId: string, slug: string, loopId: string) {
  const loop = await loopRef(teamId, slug, loopId);
  const snap = await loop.collection("sessions").orderBy("startedAt").get();
  return snap.docs.map((d) => d.data());
}
