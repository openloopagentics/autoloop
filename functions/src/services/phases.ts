import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { isTerminal, type Status } from "../status.js";
import { computeCurrentPhaseId } from "../derive.js";
import type { PhaseBody } from "../schemas.js";

export async function upsertPhase(teamId: string, slug: string, phaseId: string, body: PhaseBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const phaseRef = projectRef.collection("phases").doc(phaseId);

  await db().runTransaction(async (tx) => {
    // --- all reads first ---
    // Team existence is covered transitively: a project can only exist under a team
    // that existed when upsertProject created it, so the project check implies the team.
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");

    const phaseSnap = await tx.get(phaseRef);
    const phasesSnap = await tx.get(projectRef.collection("phases"));

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
    // endedAt = the FIRST terminal transition; once set it is never updated,
    // even if the phase is re-activated and re-completed (the server does not
    // police transitions). So retries are no-ops and endedAt is stable.
    if (isTerminal(newStatus) && !(existing.endedAt)) {
      phaseData.endedAt = FieldValue.serverTimestamp();
    }

    // --- recompute currentPhaseId from the full phase set with this write applied ---
    const phases = phasesSnap.docs
      .filter((d) => d.id !== phaseId)
      .map((d) => ({ id: d.id, order: d.data().order as number, status: d.data().status as Status }));
    phases.push({ id: phaseId, order: newOrder, status: newStatus });
    const currentPhaseId = computeCurrentPhaseId(phases);

    // --- writes ---
    tx.set(phaseRef, phaseData, { merge: true });
    tx.set(projectRef, { currentPhaseId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
