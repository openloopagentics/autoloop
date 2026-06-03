import { Router } from "express";
import { idPattern, taskBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertTask } from "../services/tasks.js";

export const tasksRouter = Router({ mergeParams: true });

tasksRouter.put("/:taskId", async (req, res, next) => {
  try {
    const { teamId, slug, taskId, loopId } = req.params as { teamId: string; slug: string; taskId: string; loopId?: string };
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["taskId", taskId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    if (loopId !== undefined && !idPattern.test(loopId)) throw new AppError(400, "validation", "invalid loopId");
    const parsed = taskBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertTask(teamId, slug, taskId, parsed.data, loopId);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
