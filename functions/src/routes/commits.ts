import { Router } from "express";
import { idPattern, commitBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertCommit } from "../services/commits.js";

export const commitsRouter = Router({ mergeParams: true });

commitsRouter.put("/:sha", async (req, res, next) => {
  try {
    const { teamId, slug, phaseId, sha } = req.params as { teamId: string; slug: string; phaseId: string; sha: string };
    for (const [id, val] of [["teamId", teamId], ["slug", slug], ["phaseId", phaseId], ["sha", sha]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${id}`);
    }
    const parsed = commitBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertCommit(teamId, slug, phaseId, sha, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
