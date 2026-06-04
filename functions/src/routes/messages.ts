import { Router } from "express";
import { idPattern, messageBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { createMessage, listPendingUserMessages, ackMessage } from "../services/messages.js";

export const messagesRouter = Router({ mergeParams: true }); // agent (API key)

messagesRouter.get("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    const messages = await listPendingUserMessages(teamId, slug);
    res.status(200).json({ ok: true, messages });
  } catch (err) { next(err); }
});

messagesRouter.post("/", async (req, res, next) => { // agent reply
  try {
    const { teamId, slug } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    const parsed = messageBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    const id = await createMessage(teamId, slug, parsed.data.text, "agent", req.uid as string);
    res.status(200).json({ ok: true, id });
  } catch (err) { next(err); }
});

messagesRouter.post("/:id/ack", async (req, res, next) => {
  try {
    const { teamId, slug, id } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    if (!id || id.trim() === "") throw new AppError(400, "validation", "invalid id");
    await ackMessage(teamId, slug, id, req.uid as string);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
