import { Router } from "express";
import { idPattern, loopBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertLoop } from "../services/loops.js";

export const loopsRouter = Router({ mergeParams: true });

loopsRouter.put("/:loopId", async (req, res, next) => {
  try {
    const { teamId, slug, loopId } = req.params as { teamId: string; slug: string; loopId: string };
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["loopId", loopId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    const parsed = loopBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertLoop(teamId, slug, loopId, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
