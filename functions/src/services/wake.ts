import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";

/** Dashboard "restart loop" signal: stamps the project doc; the host-side wake job
 *  (autoloop hook wake, launchd/cron) polls project state, sees wakeRequestedAt, and
 *  relaunches a headless driver regardless of loop status (stuck/zombie included) as
 *  long as no live session holds the lock. */
export async function requestWake(teamId: string, slug: string, uid: string): Promise<void> {
  const ref = db().doc(`teams/${teamId}/projects/${slug}`);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError(404, "not_found", "project does not exist");
  await ref.set({ wakeRequestedAt: FieldValue.serverTimestamp(), wakeRequestedBy: uid }, { merge: true });
}

/** The wake job acks (clears) the request before launching, so the 5-minute poll
 *  doesn't spawn a second driver. Idempotent: clearing an absent request is a no-op. */
export async function clearWake(teamId: string, slug: string): Promise<void> {
  const ref = db().doc(`teams/${teamId}/projects/${slug}`);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError(404, "not_found", "project does not exist");
  await ref.set({ wakeRequestedAt: FieldValue.delete(), wakeRequestedBy: FieldValue.delete() }, { merge: true });
}
