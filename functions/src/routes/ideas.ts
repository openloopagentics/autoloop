import { Router } from "express";
import { idPattern, ideaBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertIdea, listIdeas } from "../services/ideas.js";

export const ideasRouter = Router({ mergeParams: true }); // agent (API key) — project-direct only

ideasRouter.put("/:ideaId", async (req, res, next) => {
  try {
    const { teamId, slug, ideaId } = req.params as Record<string, string>;
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["ideaId", ideaId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    const parsed = ideaBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertIdea(teamId, slug, ideaId, parsed.data, "agent"); // by from the auth path
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

ideasRouter.get("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    const ideas = await listIdeas(teamId, slug);
    res.status(200).json({ ok: true, ideas });
  } catch (err) { next(err); }
});
