import express, { Router } from "express";
import { makeRequireUser } from "./requireUser.js";
import { makeRequireAdmin } from "./requireAdmin.js";
import { requireApiKeyMember } from "./requireApiKeyMember.js";
import { AppError, errorHandler } from "./errors.js";
import { keysRouter } from "./routes/keys.js";
import { adminRouter } from "./routes/admin.js";
import { projectsRouter } from "./routes/projects.js";
import { phasesRouter } from "./routes/phases.js";
import { commitsRouter } from "./routes/commits.js";

export function makeApp() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  // Human-facing key management (Firebase ID token).
  app.use("/v1/keys", makeRequireUser(), keysRouter);

  // Admin allowlist management (Firebase ID token + isAdmin).
  app.use("/v1/admin", makeRequireAdmin(), adminRouter);

  // Agent writes (API key -> user -> team membership). One auth point on the subtree.
  const teamRouter = Router({ mergeParams: true });
  teamRouter.use("/:slug/phases/:phaseId/commits", commitsRouter);
  teamRouter.use("/:slug/phases", phasesRouter);
  teamRouter.use("/", projectsRouter); // projectsRouter defines put("/:slug")
  app.use("/v1/teams/:teamId/projects", requireApiKeyMember, teamRouter);

  // Unknown route -> consistent 404 envelope (intentionally unauthenticated:
  // there is no blanket /v1 guard; each route group declares its own auth above).
  app.use((_req, _res, next) => next(new AppError(404, "not_found", "unknown route")));
  app.use(errorHandler);
  return app;
}
