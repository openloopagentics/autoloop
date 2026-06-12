import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { isTerminal, type Status } from "../status.js";
import { computeCurrentPhaseId, computeCurrentTaskId, type TaskLite } from "../derive.js";
import type { PhaseBody } from "../schemas.js";

/** Stamp endedAt on the FIRST terminal transition; once set it is never updated,
 *  even if the doc is re-activated and re-completed (the server does not police
 *  transitions). Shared by upsertPhase and the terminal backstop sweep. */
export function stampEndedAt(data: Record<string, unknown>, newStatus: Status, existingEndedAt: unknown): void {
  if (isTerminal(newStatus) && !existingEndedAt) data.endedAt = FieldValue.serverTimestamp();
}

export async function upsertPhase(teamId: string, slug: string, phaseId: string, body: PhaseBody, loopId?: string): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const baseRef = loopId ? projectRef.collection("loops").doc(loopId) : projectRef;
  const phaseRef = baseRef.collection("phases").doc(phaseId);

  await db().runTransaction(async (tx) => {
    // --- all reads first ---
    // Team existence is covered transitively: a project can only exist under a team
    // that existed when upsertProject created it, so the project check implies the team.
    // baseSnap === projectSnap in legacy mode (no extra tx.get); loop-scoped reads loopRef.
    const baseSnap = await tx.get(baseRef);
    if (!baseSnap.exists) {
      throw new AppError(404, "not_found", loopId ? "project or loop does not exist" : "project does not exist");
    }

    const phaseSnap = await tx.get(phaseRef);
    const phasesSnap = await tx.get(baseRef.collection("phases"));
    const tasksSnap = await tx.get(baseRef.collection("tasks"));

    const creating = !phaseSnap.exists;
    if (creating && (body.name === undefined || body.order === undefined || body.status === undefined)) {
      throw new AppError(400, "validation", "name, order and status are required when creating a phase");
    }

    const existing = phaseSnap.data() ?? {};
    const newStatus: Status = (body.status ?? existing.status) as Status;
    const newOrder: number = (body.order ?? existing.order) as number;

    // --- build phase update ---
    const phaseData: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (creating) {
      phaseData.startedAt = FieldValue.serverTimestamp();
      phaseData.endedAt = null;
    }
    if (body.name !== undefined) phaseData.name = body.name;
    if (body.order !== undefined) phaseData.order = body.order;
    if (body.status !== undefined) phaseData.status = body.status;
    stampEndedAt(phaseData, newStatus, existing.endedAt);

    // --- recompute currentPhaseId from the full phase set with this write applied ---
    const phases = phasesSnap.docs
      .filter((d) => d.id !== phaseId)
      .map((d) => ({ id: d.id, order: d.data().order as number, status: d.data().status as Status }));
    phases.push({ id: phaseId, order: newOrder, status: newStatus });
    const currentPhaseId = computeCurrentPhaseId(phases);

    const tasks: TaskLite[] = tasksSnap.docs
      .map((d) => ({ id: d.id, phaseId: d.data().phaseId as string, order: d.data().order as number, status: d.data().status as Status }));
    const currentTaskId = computeCurrentTaskId(currentPhaseId, tasks);

    // --- writes ---
    // Derived ids live on baseRef: the loop doc when loop-scoped, the project doc when legacy.
    tx.set(phaseRef, phaseData, { merge: true });
    tx.set(baseRef, { currentPhaseId, currentTaskId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
