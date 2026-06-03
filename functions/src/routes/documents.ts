import { Router } from "express";
import { idPattern, documentBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertDocument } from "../services/documents.js";

export const documentsRouter = Router({ mergeParams: true });

documentsRouter.put("/:docId", async (req, res, next) => {
  try {
    const { teamId, slug, docId } = req.params as { teamId: string; slug: string; docId: string };
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["docId", docId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    const parsed = documentBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertDocument(teamId, slug, docId, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
