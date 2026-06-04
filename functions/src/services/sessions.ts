import { resolveBase } from "./baseRef.js";
import type { SessionBody } from "../schemas.js";

export async function appendSession(teamId: string, slug: string, loopId: string, body: SessionBody): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug, loopId);
  const docRef = baseRef.collection("sessions").doc(body.sessionId);
  const snap = await docRef.get();
  if (snap.exists) return; // idempotent: already uploaded, skip
  await docRef.set({
    sessionId: body.sessionId,
    startedAt: body.startedAt,
    endedAt: body.endedAt,
    entries: body.entries,
  });
}

export async function listSessions(teamId: string, slug: string, loopId: string) {
  const { baseRef } = await resolveBase(teamId, slug, loopId);
  const snap = await baseRef.collection("sessions").orderBy("startedAt").get();
  return snap.docs.map((d) => d.data());
}
