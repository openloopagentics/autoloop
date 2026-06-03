import { Router } from "express";
import { idPattern, goalBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertGoal } from "../services/goals.js";

export const goalsRouter = Router({ mergeParams: true });

goalsRouter.put("/:goalId", async (req, res, next) => {
  try {
    const { teamId, slug, goalId } = req.params as { teamId: string; slug: string; goalId: string };
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["goalId", goalId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    const parsed = goalBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertGoal(teamId, slug, goalId, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
