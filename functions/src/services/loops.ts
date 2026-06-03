import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { isTerminal, type Status } from "../status.js";
import { computeCurrentLoopId } from "../derive.js";
import type { LoopBody } from "../schemas.js";

export async function upsertLoop(teamId: string, slug: string, loopId: string, body: LoopBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const loopRef = projectRef.collection("loops").doc(loopId);
  await db().runTransaction(async (tx) => {
    // --- all reads first ---
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    const loopSnap = await tx.get(loopRef);
    const loopsSnap = await tx.get(projectRef.collection("loops"));

    const creating = !loopSnap.exists;
    if (creating && (body.goal === undefined || body.order === undefined || body.status === undefined)) {
      throw new AppError(400, "validation", "goal, order and status are required when creating a loop");
    }
    const existing = loopSnap.data() ?? {};
    const newStatus: Status = (body.status ?? existing.status) as Status;
    const newOrder: number = (body.order ?? existing.order) as number;

    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (creating) { data.startedAt = FieldValue.serverTimestamp(); data.endedAt = null; }
    if (body.goal !== undefined) data.goal = body.goal;
    if (body.name !== undefined) data.name = body.name;
    if (body.order !== undefined) data.order = body.order;
    if (body.status !== undefined) data.status = body.status;
    // endedAt = the FIRST terminal transition; once set it is never updated.
    if (isTerminal(newStatus) && !existing.endedAt) data.endedAt = FieldValue.serverTimestamp();

    // --- recompute currentLoopId from the full loop set with this write applied ---
    const loops = loopsSnap.docs.filter((d) => d.id !== loopId)
      .map((d) => ({ id: d.id, order: d.data().order as number, status: d.data().status as Status }));
    loops.push({ id: loopId, order: newOrder, status: newStatus });
    const currentLoopId = computeCurrentLoopId(loops);

    tx.set(loopRef, data, { merge: true });
    tx.set(projectRef, { currentLoopId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
