import { Router } from "express";
import { idPattern, scoreBody, testRunBody, revisionBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { appendScore, appendTestRun, appendRevision } from "../services/events.js";

export const scoresRouter = Router({ mergeParams: true });

scoresRouter.post("/", async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId?: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    if (loopId !== undefined && !idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const parsed = scoreBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await appendScore(teamId, slug, parsed.data, loopId);
    res.status(200).json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

export const testRunsRouter = Router({ mergeParams: true });
testRunsRouter.post("/", async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId?: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    if (loopId !== undefined && !idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const parsed = testRunBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await appendTestRun(teamId, slug, parsed.data, loopId);
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});

export const revisionsRouter = Router({ mergeParams: true });
revisionsRouter.post("/", async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId?: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug)) throw new AppError(400, "validation", "invalid project slug");
    if (loopId !== undefined && !idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const parsed = revisionBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await appendRevision(teamId, slug, parsed.data, loopId);
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});
