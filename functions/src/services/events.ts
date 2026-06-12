import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../errors.js";
import { ulid } from "../ulid.js";
import type { ScoreBody, TestRunBody, RevisionBody, VerificationBody } from "../schemas.js";
import { resolveBase } from "./baseRef.js";

/** Append a score event. Server stamps the id (sortable ULID) + createdAt. Returns the id. */
export async function appendScore(teamId: string, slug: string, body: ScoreBody, loopId?: string): Promise<string> {
  const { projectRef, baseRef } = await resolveBase(teamId, slug, loopId);
  // Scenarios are project-level vision — always read from the PROJECT, never the loop.
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
  // No transaction needed: the id is server-generated (no write-write conflict) and no derived fields are updated.
  await baseRef.collection("scores").doc(id).set(data);
  return id;
}

export async function appendTestRun(teamId: string, slug: string, body: TestRunBody, loopId?: string): Promise<string> {
  const { baseRef } = await resolveBase(teamId, slug, loopId);
  const id = ulid();
  // No transaction needed: the id is server-generated (no write-write conflict) and no derived fields are updated.
  const data: Record<string, unknown> = {
    scenarioId: body.scenarioId,
    taskId: body.taskId,
    passed: body.passed,
    failed: body.failed,
    issues: body.issues ?? [],
    createdAt: FieldValue.serverTimestamp(),
  };
  if (body.summary !== undefined) data.summary = body.summary;
  await baseRef.collection("testRuns").doc(id).set(data);
  return id;
}

export async function appendRevision(teamId: string, slug: string, body: RevisionBody, loopId?: string): Promise<string> {
  const { baseRef } = await resolveBase(teamId, slug, loopId);
  const id = ulid();
  // No transaction needed: the id is server-generated (no write-write conflict) and no derived fields are updated.
  await baseRef.collection("revisions").doc(id).set({
    trigger: body.trigger,
    changes: body.changes,
    createdAt: FieldValue.serverTimestamp(),
  });
  return id;
}

export async function appendVerification(teamId: string, slug: string, body: VerificationBody, loopId?: string): Promise<string> {
  const { baseRef } = await resolveBase(teamId, slug, loopId);
  const id = ulid();
  // No transaction needed: the id is server-generated (no write-write conflict) and no derived fields are updated.
  const data: Record<string, unknown> = {
    scenarioId: body.scenarioId,
    testRunId: body.testRunId,
    verdict: body.verdict,
    by: body.by ?? "verifier",
    createdAt: FieldValue.serverTimestamp(),
  };
  if (body.taskId !== undefined) data.taskId = body.taskId;
  if (body.summary !== undefined) data.summary = body.summary;
  await baseRef.collection("verifications").doc(id).set(data);
  return id;
}
