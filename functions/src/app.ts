import express, { Router } from "express";
import { ensureApp } from "./firestore.js";
import { makeRequireUser } from "./requireUser.js";
import { makeRequireAdmin } from "./requireAdmin.js";
import { requireApiKeyMember } from "./requireApiKeyMember.js";
import { requireMember } from "./requireMember.js";
import { AppError, errorHandler } from "./errors.js";
import { keysRouter } from "./routes/keys.js";
import { adminRouter } from "./routes/admin.js";
import { projectsRouter } from "./routes/projects.js";
import { phasesRouter } from "./routes/phases.js";
import { commitsRouter } from "./routes/commits.js";
import { goalsRouter } from "./routes/goals.js";
import { scenariosRouter } from "./routes/scenarios.js";
import { tasksRouter } from "./routes/tasks.js";
import { taskCommitsRouter } from "./routes/taskCommits.js";
import { documentsRouter } from "./routes/documents.js";
import { scoresRouter, testRunsRouter, revisionsRouter } from "./routes/events.js";
import { loopsRouter } from "./routes/loops.js";
import { bugsRouter } from "./routes/bugs.js";
import { messagesRouter } from "./routes/messages.js";
import { userProjectsRouter } from "./routes/userProjects.js";

export function makeApp() {
  // Initialize the Admin SDK before any handler runs, so the ID-token auth
  // middleware (getAuth().verifyIdToken) has a default app on a cold instance
  // whose first request is ID-token-gated (e.g. GET /v1/keys).
  ensureApp();

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
  teamRouter.use("/:slug/goals", goalsRouter);
  teamRouter.use("/:slug/scenarios", scenariosRouter);
  teamRouter.use("/:slug/tasks/:taskId/commits", taskCommitsRouter);
  teamRouter.use("/:slug/tasks", tasksRouter);
  teamRouter.use("/:slug/documents", documentsRouter);
  teamRouter.use("/:slug/scores", scoresRouter);
  teamRouter.use("/:slug/testRuns", testRunsRouter);
  teamRouter.use("/:slug/revisions", revisionsRouter);
  teamRouter.use("/:slug/bugs", bugsRouter);
  teamRouter.use("/:slug/messages", messagesRouter);
  // Loop-scoped variants reuse the SAME routers (mergeParams propagates :loopId).
  // Order: more-specific mounts before the /:slug/loops entity mount.
  teamRouter.use("/:slug/loops/:loopId/tasks/:taskId/commits", taskCommitsRouter);
  teamRouter.use("/:slug/loops/:loopId/tasks", tasksRouter);
  teamRouter.use("/:slug/loops/:loopId/phases", phasesRouter);
  teamRouter.use("/:slug/loops/:loopId/scores", scoresRouter);
  teamRouter.use("/:slug/loops/:loopId/testRuns", testRunsRouter);
  teamRouter.use("/:slug/loops/:loopId/revisions", revisionsRouter);
  teamRouter.use("/:slug/loops/:loopId/bugs", bugsRouter);
  teamRouter.use("/:slug/loops", loopsRouter); // loop entity
  teamRouter.use("/", projectsRouter); // projectsRouter defines put("/:slug")
  app.use("/v1/teams/:teamId/projects", requireApiKeyMember, teamRouter);

  // User vision writes (Firebase ID token -> team membership). Web-owned projects only.
  app.use("/v1/u/teams/:teamId/projects", makeRequireUser(), requireMember, userProjectsRouter);

  // Unknown route -> consistent 404 envelope (intentionally unauthenticated:
  // there is no blanket /v1 guard; each route group declares its own auth above).
  app.use((_req, _res, next) => next(new AppError(404, "not_found", "unknown route")));
  app.use(errorHandler);
  return app;
}
