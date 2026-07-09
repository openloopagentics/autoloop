import { Router } from "express";
import { idPattern, commentReplyBody, commentResolveBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { listComments, replyToComment, resolveComment } from "../services/comments.js";

export const commentsRouter = Router({ mergeParams: true }); // agent (API key)

commentsRouter.get("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const comments = await listComments(teamId, slug, status);
    res.status(200).json({ ok: true, comments });
  } catch (err) { next(err); }
});

// Comment ids are server ULIDs (UPPERCASE) — validate non-empty only, never idPattern
// (precedent: messages ack, vision-changes reject).
commentsRouter.post("/:id/reply", async (req, res, next) => {
  try {
    const { teamId, slug, id } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    if (!id || id.trim() === "") throw new AppError(400, "validation", "invalid id");
    const parsed = commentReplyBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await replyToComment(teamId, slug, id, parsed.data.text);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

commentsRouter.post("/:id/resolve", async (req, res, next) => {
  try {
    const { teamId, slug, id } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    if (!id || id.trim() === "") throw new AppError(400, "validation", "invalid id");
    const parsed = commentResolveBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await resolveComment(teamId, slug, id, parsed.data.resolution, parsed.data.note);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
