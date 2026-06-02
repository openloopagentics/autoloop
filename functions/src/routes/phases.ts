import { Router } from "express";
import { idPattern, phaseBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertPhase } from "../services/phases.js";

// mergeParams lets this router read :slug from the parent mount path.
export const phasesRouter = Router({ mergeParams: true });

phasesRouter.put("/:phaseId", async (req, res, next) => {
  try {
    const { slug, phaseId } = req.params as { slug: string; phaseId: string };
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    if (!idPattern.test(phaseId)) throw new AppError(400, "validation", "invalid phase id");
    const parsed = phaseBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertPhase(slug, phaseId, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
