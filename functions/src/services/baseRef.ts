import { db } from "../firestore.js";
import { AppError } from "../errors.js";

async function requireProject(teamId: string, slug: string) {
  const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
  const snap = await projectRef.get();
  if (!snap.exists) throw new AppError(404, "not_found", "project does not exist");
  return projectRef;
}

/**
 * Resolve the base ref for run-data writes: the loop doc when loop-scoped, else the project.
 * Verifies the project (always) and the loop (when loopId) exist.
 */
export async function resolveBase(teamId: string, slug: string, loopId?: string) {
  const projectRef = await requireProject(teamId, slug);
  if (!loopId) return { projectRef, baseRef: projectRef };
  const loopRef = projectRef.collection("loops").doc(loopId);
  if (!(await loopRef.get()).exists) throw new AppError(404, "not_found", "loop does not exist");
  return { projectRef, baseRef: loopRef };
}
