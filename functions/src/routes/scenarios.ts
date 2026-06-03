import { Router } from "express";
import { idPattern, scenarioBody } from "../schemas.js";
import { AppError } from "../errors.js";
import { upsertScenario } from "../services/scenarios.js";

export const scenariosRouter = Router({ mergeParams: true });

scenariosRouter.put("/:scenarioId", async (req, res, next) => {
  try {
    const { teamId, slug, scenarioId } = req.params as { teamId: string; slug: string; scenarioId: string };
    for (const [name, val] of [["teamId", teamId], ["slug", slug], ["scenarioId", scenarioId]] as const) {
      if (!idPattern.test(val)) throw new AppError(400, "validation", `invalid ${name}`);
    }
    const parsed = scenarioBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    await upsertScenario(teamId, slug, scenarioId, parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
