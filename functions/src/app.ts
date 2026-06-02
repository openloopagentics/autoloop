import express from "express";
import { requireWriteKey } from "./auth.js";
import { AppError, errorHandler } from "./errors.js";
import { projectsRouter } from "./routes/projects.js";
import { phasesRouter } from "./routes/phases.js";
import { commitsRouter } from "./routes/commits.js";

export function makeApp() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  // All write routes require the API key.
  app.use("/v1", requireWriteKey);
  app.use("/v1/projects", projectsRouter);
  app.use("/v1/projects/:slug/phases", phasesRouter);
  app.use("/v1/projects/:slug/phases/:phaseId/commits", commitsRouter);
  // Unknown route -> consistent 404 envelope (not Express's bare default 404).
  app.use((_req, _res, next) => next(new AppError(404, "not_found", "unknown route")));
  app.use(errorHandler);
  return app;
}
