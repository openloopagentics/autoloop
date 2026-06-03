import { Router } from "express";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { idPattern, projectBody, goalBody, scenarioBody, documentBody } from "../schemas.js";
import { assertWebEditable } from "../services/visionOwner.js";
import { applyProjectUpsert } from "../services/projects.js";
import { applyGoalUpsert, deleteGoal } from "../services/goals.js";
import { applyScenarioUpsert, deleteScenario } from "../services/scenarios.js";
import { applyDocumentUpsert, deleteDocument } from "../services/documents.js";

export const userProjectsRouter = Router({ mergeParams: true });

function ids(req: { params: Record<string, string> }, names: string[]) {
  for (const n of names) if (!idPattern.test(req.params[n] ?? "")) throw new AppError(400, "validation", `invalid ${n}`);
}

// project: PUT /:slug
userProjectsRouter.put("/:slug", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug"]);
    const parsed = projectBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug } = req.params as Record<string, string>;
    const teamRef = db().doc(`teams/${teamId}`);
    const ref = db().doc(`teams/${teamId}/projects/${slug}`);
    await db().runTransaction(async (tx) => {
      const projSnap = await tx.get(ref);
      if (projSnap.exists) assertWebEditable(projSnap); // patch must not be loop-owned; create is fine
      await applyProjectUpsert(tx, teamRef, ref, slug, parsed.data, "web");
    });
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

// goals: PUT /:slug/goals/:goalId  and  DELETE /:slug/goals/:goalId
userProjectsRouter.put("/:slug/goals/:goalId", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug", "goalId"]);
    const parsed = goalBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug, goalId } = req.params as Record<string, string>;
    const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
    const goalRef = projectRef.collection("goals").doc(goalId);
    await db().runTransaction(async (tx) => {
      const projSnap = await tx.get(projectRef);
      assertWebEditable(projSnap);
      await applyGoalUpsert(tx, projectRef, goalRef, parsed.data, "web");
    });
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
userProjectsRouter.delete("/:slug/goals/:goalId", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug", "goalId"]);
    const { teamId, slug, goalId } = req.params as Record<string, string>;
    await deleteGoal(teamId, slug, goalId);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

// scenarios: PUT /:slug/scenarios/:scenarioId  and  DELETE /:slug/scenarios/:scenarioId
userProjectsRouter.put("/:slug/scenarios/:scenarioId", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug", "scenarioId"]);
    const parsed = scenarioBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug, scenarioId } = req.params as Record<string, string>;
    const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
    const ref = projectRef.collection("scenarios").doc(scenarioId);
    await db().runTransaction(async (tx) => {
      const projSnap = await tx.get(projectRef);
      assertWebEditable(projSnap);
      await applyScenarioUpsert(tx, projectRef, ref, parsed.data, "web");
    });
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
userProjectsRouter.delete("/:slug/scenarios/:scenarioId", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug", "scenarioId"]);
    const { teamId, slug, scenarioId } = req.params as Record<string, string>;
    await deleteScenario(teamId, slug, scenarioId);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

// documents: PUT /:slug/documents/:docId  and  DELETE /:slug/documents/:docId
userProjectsRouter.put("/:slug/documents/:docId", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug", "docId"]);
    const parsed = documentBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug, docId } = req.params as Record<string, string>;
    const projectRef = db().doc(`teams/${teamId}/projects/${slug}`);
    const ref = projectRef.collection("documents").doc(docId);
    await db().runTransaction(async (tx) => {
      const projSnap = await tx.get(projectRef);
      assertWebEditable(projSnap);
      await applyDocumentUpsert(tx, projectRef, ref, parsed.data, "web");
    });
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
userProjectsRouter.delete("/:slug/documents/:docId", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug", "docId"]);
    const { teamId, slug, docId } = req.params as Record<string, string>;
    await deleteDocument(teamId, slug, docId);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
