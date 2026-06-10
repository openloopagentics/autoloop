import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { ulid } from "../ulid.js";
import { goalBody, scenarioBody } from "../schemas.js";
import type { VisionChangeBody, GoalBody, ScenarioBody } from "../schemas.js";
import { applyGoalUpsert } from "./goals.js";
import { applyScenarioUpsert } from "./scenarios.js";

/**
 * Propose-and-apply a vision change in ONE transaction: capture the target's `prior`
 * state, run the SAME inner upsert helper a direct agent PUT uses (owner "loop"),
 * and record the visionChanges/{ulid} event with status "applied".
 * Returns the server-generated change id.
 */
export async function applyVisionChange(teamId: string, slug: string, body: VisionChangeBody): Promise<string> {
  const isGoal = body.op === "upsert-goal";
  // Re-validate the payload per-op with the SAME zod the direct routes use, so
  // error messages match direct upserts exactly.
  const parsed = (isGoal ? goalBody : scenarioBody).safeParse(body.payload);
  if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);

  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const targetRef = projectRef.collection(isGoal ? "goals" : "scenarios").doc(body.targetId);
  const changeId = ulid();
  await db().runTransaction(async (tx) => {
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
    // Capture `prior` BEFORE dispatching. The upsert helper re-reads the target inside
    // this same transaction — the duplicate read is deliberate (snapshot-consistent,
    // both reads precede all writes). Do NOT refactor the helpers to take a snapshot.
    const targetSnap = await tx.get(targetRef);
    const prior = targetSnap.exists ? targetSnap.data()! : null;
    if (isGoal) await applyGoalUpsert(tx, projectRef, targetRef, parsed.data as GoalBody, "loop");
    else await applyScenarioUpsert(tx, projectRef, targetRef, parsed.data as ScenarioBody, "loop");
    const change: Record<string, unknown> = {
      op: body.op,
      targetId: body.targetId,
      payload: parsed.data, // the body that was applied (zod-stripped)
      prior,                // null on create; Timestamps round-trip via the admin SDK
      reason: body.reason,
      status: "applied",
      createdAt: FieldValue.serverTimestamp(),
    };
    if (body.originLoopId !== undefined) change.originLoopId = body.originLoopId;
    tx.set(projectRef.collection("visionChanges").doc(changeId), change);
  });
  return changeId;
}

/**
 * User veto: restore the target to `prior` (null ⇒ delete it) and mark the change
 * rejected. Idempotent when already rejected. Deliberately does NOT touch visionOwner
 * (the apply stamped it "loop"; nobody "helpfully" resets ownership on reject).
 */
export async function rejectVisionChange(teamId: string, slug: string, changeId: string): Promise<void> {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const changeRef = projectRef.collection("visionChanges").doc(changeId);
  await db().runTransaction(async (tx) => {
    const changeSnap = await tx.get(changeRef);
    if (!changeSnap.exists) throw new AppError(404, "not_found", "vision change does not exist");
    const change = changeSnap.data()!;
    if (change.status === "rejected") return; // idempotent
    const isGoal = change.op === "upsert-goal";
    const targetRef = projectRef.collection(isGoal ? "goals" : "scenarios").doc(change.targetId);
    if (change.prior === null) {
      tx.delete(targetRef); // the change created the target — rejecting removes it
    } else {
      // Wholesale restore (set WITHOUT merge) so fields the change ADDED are removed;
      // re-stamp updatedAt so it isn't the stale prior value.
      tx.set(targetRef, { ...change.prior, updatedAt: FieldValue.serverTimestamp() });
    }
    tx.set(changeRef, { status: "rejected", decidedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
