import { Router } from "express";
import { db } from "../firestore.js";
import { AppError } from "../errors.js";
import { idPattern, projectBody, goalBody, scenarioBody, documentBody, messageBody, ideaBody, commentBody } from "../schemas.js";
import { assertWebEditable } from "../services/visionOwner.js";
import { applyProjectUpsert, deleteProject } from "../services/projects.js";
import { applyGoalUpsert, deleteGoal } from "../services/goals.js";
import { applyScenarioUpsert, deleteScenario } from "../services/scenarios.js";
import { applyDocumentUpsert, deleteDocument } from "../services/documents.js";
import { createMessage } from "../services/messages.js";
import { upsertIdea } from "../services/ideas.js";
import { rejectVisionChange } from "../services/visionChanges.js";
import { createComment, acceptComment } from "../services/comments.js";

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

// project: DELETE /:slug — permanent, recursive. Owners/managers only.
userProjectsRouter.delete("/:slug", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug"]);
    const { teamId, slug } = req.params as Record<string, string>;
    const uid = (req as { uid?: string }).uid ?? "";
    const role = (await db().doc(`teams/${teamId}/members/${uid}`).get()).data()?.role;
    if (role !== "owner" && role !== "manager") {
      throw new AppError(403, "forbidden", "only an owner or manager can delete a project");
    }
    await deleteProject(teamId, slug);
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

// messages: POST /:slug/messages
userProjectsRouter.post("/:slug/messages", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug"]);
    const parsed = messageBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug } = req.params as Record<string, string>;
    const id = await createMessage(teamId, slug, parsed.data.text, "user", (req as { uid?: string }).uid ?? "");
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});

// ideas: PUT /:slug/ideas/:ideaId — accept / reject / reorder / add.
// Deliberately NO assertWebEditable: steering must work WHILE the loop owns the
// project (visionOwner === "loop") — that is the whole point of the veto.
userProjectsRouter.put("/:slug/ideas/:ideaId", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug", "ideaId"]);
    const parsed = ideaBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug, ideaId } = req.params as Record<string, string>;
    await upsertIdea(teamId, slug, ideaId, parsed.data, "user"); // by from the auth path
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

// vision changes: POST /:slug/vision-changes/:changeId/reject
// Deliberately NO assertWebEditable — like the ideas veto and the messages POST,
// rejecting must work while the loop owns the vision.
// changeId is a server ULID (UPPERCASE) — validate non-empty only, never idPattern
// (precedent: messages ack).
userProjectsRouter.post("/:slug/vision-changes/:changeId/reject", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug"]);
    const { teamId, slug, changeId } = req.params as Record<string, string>;
    if (!changeId || changeId.trim() === "") throw new AppError(400, "validation", "invalid changeId");
    await rejectVisionChange(teamId, slug, changeId);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

// comments: POST /:slug/comments  (create) and  POST /:slug/comments/:id/accept.
// Deliberately NO assertWebEditable — like the ideas veto and vision-change reject,
// steering must work WHILE the loop owns the vision.
userProjectsRouter.post("/:slug/comments", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug"]);
    const parsed = commentBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const { teamId, slug } = req.params as Record<string, string>;
    const id = await createComment(teamId, slug, parsed.data, (req as { uid?: string }).uid ?? "");
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});

// commentId is a server ULID (UPPERCASE) — validate non-empty only, never idPattern
// (precedent: messages ack, vision-changes reject).
userProjectsRouter.post("/:slug/comments/:id/accept", async (req, res, next) => {
  try {
    ids(req, ["teamId", "slug"]);
    const { teamId, slug, id } = req.params as Record<string, string>;
    if (!id || id.trim() === "") throw new AppError(400, "validation", "invalid id");
    await acceptComment(teamId, slug, id, (req as { uid?: string }).uid ?? "");
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
