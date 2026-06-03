import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../errors.js";
import { resolveBase } from "./baseRef.js";
import type { BugBody } from "../schemas.js";

/**
 * Upsert a bug (idempotent PUT). Base-path-aware: loop-scoped when loopId is set, else
 * project-direct. A bug is run data — no derived currentX, no visionOwner stamp.
 * fixedAt is stamped the FIRST time status becomes "fixed" and never updated after.
 * Non-transactional: a single doc merge with no derived fields (mirrors the event appenders).
 */
export async function upsertBug(teamId: string, slug: string, bugId: string, body: BugBody, loopId?: string): Promise<void> {
  const { baseRef } = await resolveBase(teamId, slug, loopId);
  const bugRef = baseRef.collection("bugs").doc(bugId);
  const snap = await bugRef.get();
  const creating = !snap.exists;
  if (creating && (body.title === undefined || body.status === undefined)) {
    throw new AppError(400, "validation", "title and status are required when creating a bug");
  }
  const existing = snap.data() ?? {};
  const newStatus = body.status ?? existing.status;

  const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (creating) { data.createdAt = FieldValue.serverTimestamp(); data.fixedAt = null; }
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.scenarioId !== undefined) data.scenarioId = body.scenarioId;
  if (body.taskId !== undefined) data.taskId = body.taskId;
  if (body.severity !== undefined) data.severity = body.severity;
  if (body.status !== undefined) data.status = body.status;
  // fixedAt = the FIRST transition to "fixed"; once set it is never updated (mirrors phase endedAt).
  if (newStatus === "fixed" && !existing.fixedAt) data.fixedAt = FieldValue.serverTimestamp();

  await bugRef.set(data, { merge: true });
}
