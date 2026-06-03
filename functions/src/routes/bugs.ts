import { Router } from "express";
import { idPattern, bugBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertBug } from "../services/bugs.js";

export const bugsRouter = Router({ mergeParams: true });

bugsRouter.put("/:bugId", async (req, res, next) => {
  try {
    const { teamId, slug, bugId, loopId } = req.params as { teamId: string; slug: string; bugId: string; loopId?: string };
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["bugId", bugId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    if (loopId !== undefined && !idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const parsed = bugBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertBug(teamId, slug, bugId, parsed.data, loopId);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
