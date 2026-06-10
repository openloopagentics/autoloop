import { Router } from "express";
import { idPattern, visionChangeBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { applyVisionChange } from "../services/visionChanges.js";

export const visionChangesRouter = Router({ mergeParams: true });

visionChangesRouter.post("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as { teamId: string; slug: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    const parsed = visionChangeBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await applyVisionChange(teamId, slug, parsed.data);
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});
