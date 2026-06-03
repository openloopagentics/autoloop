import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { ulid } from "../ulid.js";
import type { ScoreBody } from "../schemas.js";

/** Append a score event. Server stamps the id (sortable ULID) + createdAt. Returns the id. */
export async function appendScore(teamId: string, slug: string, body: ScoreBody): Promise<string> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const scenarioRef = projectRef.collection("scenarios").doc(body.scenarioId);
  const scenarioSnap = await scenarioRef.get();
  if (!scenarioSnap.exists) throw new AppError(404, "not_found", "scenario does not exist");

  // Service-layer validation: criterion keys must match the rubric ids, values <= max.
  const criteria = (scenarioSnap.data()!.rubric?.criteria ?? []) as Array<{ id: string; max: number }>;
  const maxById = new Map(criteria.map((c) => [c.id, c.max]));
  for (const [key, val] of Object.entries(body.criteria)) {
    if (!maxById.has(key)) throw new AppError(400, "validation", `unknown criterion '${key}'`);
    if (val > (maxById.get(key) as number)) throw new AppError(400, "validation", `criterion '${key}' exceeds max ${maxById.get(key)}`);
  }

  const id = ulid();
  const data: Record<string, unknown> = {
    scenarioId: body.scenarioId,
    taskId: body.taskId,
    criteria: body.criteria,
    composite: body.composite,
    by: body.by ?? "ai",
    createdAt: FieldValue.serverTimestamp(),
  };
  if (body.commitSha !== undefined) data.commitSha = body.commitSha;
  if (body.note !== undefined) data.note = body.note;
  await projectRef.collection("scores").doc(id).set(data);
  return id;
}
