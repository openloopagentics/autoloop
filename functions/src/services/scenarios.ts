import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import type { ScenarioBody } from "../schemas.js";

export async function upsertScenario(teamId: string, slug: string, scenarioId: string, body: ScenarioBody): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const ref = projectRef.collection("scenarios").doc(scenarioId);
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    const snap = await tx.get(ref);
    if (!snap.exists && (body.goalId === undefined || body.title === undefined || body.rubric === undefined)) {
      throw new AppError(400, "validation", "goalId, title and rubric are required when creating a scenario");
    }
    const data: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (!snap.exists) data.createdAt = FieldValue.serverTimestamp();
    if (body.goalId !== undefined) data.goalId = body.goalId;
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.order !== undefined) data.order = body.order;
    if (body.threshold !== undefined) data.threshold = body.threshold;
    if (body.rubric !== undefined) data.rubric = body.rubric;
    tx.set(ref, data, { merge: true });
  });
}
