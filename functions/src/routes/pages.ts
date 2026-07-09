import { Router } from "express";
import { idPattern, pageBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertPage, listPages, deletePage } from "../services/pages.js";

export const pagesRouter = Router({ mergeParams: true }); // agent (API key) — project-direct only

pagesRouter.put("/:pageId", async (req, res, next) => {
  try {
    const { teamId, slug, pageId } = req.params as { teamId: string; slug: string; pageId: string };
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["pageId", pageId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    const parsed = pageBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertPage(teamId, slug, pageId, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

pagesRouter.get("/", async (req, res, next) => {
  try {
    const { teamId, slug } = req.params as Record<string, string>;
    if (!idPattern.test(teamId) || !idPattern.test(slug)) throw new AppError(400, "validation", "invalid teamId/slug");
    const pages = await listPages(teamId, slug);
    res.status(200).json({ ok: true, pages });
  } catch (err) { next(err); }
});

pagesRouter.delete("/:pageId", async (req, res, next) => {
  try {
    const { teamId, slug, pageId } = req.params as { teamId: string; slug: string; pageId: string };
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["pageId", pageId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    await deletePage(teamId, slug, pageId);
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});
