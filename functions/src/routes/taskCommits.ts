import { Router } from "express";
import { idPattern, commitBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertTaskCommit } from "../services/taskCommits.js";

export const taskCommitsRouter = Router({ mergeParams: true });

taskCommitsRouter.put("/:sha", async (req, res, next) => {
  try {
    const { teamId, slug, taskId, sha } = req.params as { teamId: string; slug: string; taskId: string; sha: string };
    for (const [id, val] of [["teamId", teamId], ["slug", slug], ["taskId", taskId], ["sha", sha]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${id}`);
    }
    const parsed = commitBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertTaskCommit(teamId, slug, taskId, sha, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
