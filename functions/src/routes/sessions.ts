import { Router, json } from "express";
import { AppError } from "../errors.js";
import { idPattern, sessionBody } from "../schemas.js";
import { appendSession, listSessions } from "../services/sessions.js";

export const sessionsRouter = Router({ mergeParams: true });

sessionsRouter.post("/", json({ limit: "512kb" }), async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug))   throw new AppError(400, "validation", "invalid slug");
    if (!idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const parsed = sessionBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await appendSession(teamId, slug, loopId, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

sessionsRouter.get("/", async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId: string };
    if (!idPattern.test(teamId)) throw new AppError(400, "validation", "invalid teamId");
    if (!idPattern.test(slug))   throw new AppError(400, "validation", "invalid slug");
    if (!idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const sessions = await listSessions(teamId, slug, loopId);
    res.status(200).json({ ok: true, sessions });
  } catch (err) { next(err); }
});
