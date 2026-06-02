import { Router } from "express";
import { idPattern, projectBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertProject } from "../services/projects.js";

export const projectsRouter = Router({ mergeParams: true });

projectsRouter.put("/:slug", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as { teamId: string; slug: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    const parsed = projectBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertProject(teamId, slug, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
