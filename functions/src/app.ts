import express from "express";
import { requireWriteKey } from "./auth.js";
import { errorHandler } from "./errors.js";
import { projectsRouter } from "./routes/projects.js";

export function makeApp() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  // All write routes require the API key.
  app.use("/v1", requireWriteKey);
  app.use("/v1/projects", projectsRouter);
  app.use(errorHandler);
  return app;
}
