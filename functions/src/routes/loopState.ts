import { Router } from "express";
import { idPattern } from "../schemas.js";
import { AppError } from "../errors.js";
import { getLoopState } from "../services/loopState.js";

export const stateRouter = Router({ mergeParams: true }); // agent read (API key)

stateRouter.get("/", async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId?: string };
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    if (loopId !== undefined && !idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const state = await getLoopState(teamId, slug, loopId);
    res.status(200).json({ ok: true, state });
  } catch (err) { next(err); }
});
