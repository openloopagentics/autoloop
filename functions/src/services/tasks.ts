import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { computeCurrentTaskId, type TaskLite } from "../derive.js";
import type { Status } from "../status.js";
import type { TaskBody } from "../schemas.js";

export async function upsertTask(teamId: string, slug: string, taskId: string, body: TaskBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const taskRef = projectRef.collection("tasks").doc(taskId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    const taskSnap = await tx.get(taskRef);
    const tasksSnap = await tx.get(projectRef.collection("tasks"));

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
    const currentPhaseId = (projectSnap.data()!.currentPhaseId ?? null) as string | null;
    const tasks: TaskLite[] = tasksSnap.docs
      .filter((d) => d.id !== taskId)
      .map((d) => ({ id: d.id, phaseId: d.data().phaseId as string, order: d.data().order as number, status: d.data().status as Status }));
    tasks.push({ id: taskId, phaseId: newPhaseId, order: newOrder, status: newStatus });
    const currentTaskId = computeCurrentTaskId(currentPhaseId, tasks);

    tx.set(taskRef, data, { merge: true });
    tx.set(projectRef, { currentTaskId, visionOwner: "loop", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
