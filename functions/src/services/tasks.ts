import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { computeCurrentTaskId, type TaskLite } from "../derive.js";
import type { Status } from "../status.js";
import type { TaskBody } from "../schemas.js";

export async function upsertTask(teamId: string, slug: string, taskId: string, body: TaskBody, loopId?: string): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const baseRef = loopId ? projectRef.collection("loops").doc(loopId) : projectRef;
  const taskRef = baseRef.collection("tasks").doc(taskId);
  await db().runTransaction(async (tx) => {
    // baseSnap === projectSnap in legacy mode (no extra tx.get); loop-scoped reads loopRef.
    const baseSnap = await tx.get(baseRef);
    if (!baseSnap.exists) {
      throw new AppError(404, "not_found", loopId ? "project or loop does not exist" : "project does not exist");
    }
    const taskSnap = await tx.get(taskRef);
    const tasksSnap = await tx.get(baseRef.collection("tasks"));

    const creating = !taskSnap.exists;
    if (creating && (body.phaseId === undefined || body.title === undefined || body.order === undefined || body.status === undefined)) {
      throw new AppError(400, "validation", "phaseId, title, order and status are required when creating a task");
    }
    const existing = taskSnap.data() ?? {};
    const newPhaseId: string = (body.phaseId ?? existing.phaseId) as string;
    const newOrder: number = (body.order ?? existing.order) as number;
    const newStatus: Status = (body.status ?? existing.status) as Status;

    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (creating) data.createdAt = FieldValue.serverTimestamp();
    if (body.phaseId !== undefined) data.phaseId = body.phaseId;
    if (body.title !== undefined) data.title = body.title;
    if (body.order !== undefined) data.order = body.order;
    if (body.status !== undefined) data.status = body.status;
    if (body.scenarioIds !== undefined) data.scenarioIds = body.scenarioIds;

    // --- recompute currentTaskId from the full task set with this write applied ---
    // currentPhaseId comes from baseSnap: the loop doc when loop-scoped, the project doc when legacy.
    const currentPhaseId = (baseSnap.data()!.currentPhaseId ?? null) as string | null;
    const tasks: TaskLite[] = tasksSnap.docs
      .filter((d) => d.id !== taskId)
      .map((d) => ({ id: d.id, phaseId: d.data().phaseId as string, order: d.data().order as number, status: d.data().status as Status }));
    tasks.push({ id: taskId, phaseId: newPhaseId, order: newOrder, status: newStatus });
    const currentTaskId = computeCurrentTaskId(currentPhaseId, tasks);

    tx.set(taskRef, data, { merge: true });
    if (loopId) {
      // Loop-scoped: per-loop currentTaskId on the loop doc; visionOwner stays on the PROJECT.
      tx.set(baseRef, { currentTaskId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(projectRef, { visionOwner: "loop", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    } else {
      // Legacy: baseRef === projectRef — fold both into one set (byte-identical to today's write).
      tx.set(projectRef, { currentTaskId, visionOwner: "loop", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
}
