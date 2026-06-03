import { z } from "zod";
import { STATUSES } from "./status.js";

// URL-/Firestore-safe IDs (slug, phaseId, sha). No slashes — IDs are single path
// segments, so allow only lowercase alnum and . _ -
export const idPattern = /^[a-z0-9._-]+$/;

const status = z.enum(STATUSES);

const contentFormat = z.enum(["markdown", "url"]);
const CONTENT_MAX_BYTES = 100 * 1024;

const design = z.object({
  format: contentFormat,
  content: z.string().max(CONTENT_MAX_BYTES, "design.content exceeds 100KB"),
});

// All content fields optional (required-on-create is enforced in the service layer).
// Plain z.object (no .strict/.passthrough) DROPS unknown keys, so client-supplied
// server-owned fields (currentPhaseId, createdAt, ...) are silently ignored.
export const projectBody = z.object({
  title: z.string().min(1).optional(),
  status: status.optional(),
  design: design.optional(),
});

export const phaseBody = z.object({
  name: z.string().min(1).optional(),
  order: z.number().int().optional(),
  status: status.optional(),
});

export const commitBody = z.object({
  message: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  url: z.string().url().nullable().optional(),
  committedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type ProjectBody = z.infer<typeof projectBody>;
export type PhaseBody = z.infer<typeof phaseBody>;
export type CommitBody = z.infer<typeof commitBody>;

const id = z.string().regex(idPattern);

export const goalBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  order: z.number().int().optional(),
});

const rubricCriterion = z.object({
  id,
  name: z.string().min(1),
  weight: z.number().positive(),
  max: z.number().int().min(1),
});
const rubric = z.object({ criteria: z.array(rubricCriterion).min(1) });

export const scenarioBody = z.object({
  goalId: id.optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  order: z.number().int().optional(),
  threshold: z.number().min(0).max(100).optional(),
  rubric: rubric.optional(),
});

export const taskBody = z.object({
  phaseId: id.optional(),
  title: z.string().min(1).optional(),
  order: z.number().int().optional(),
  status: status.optional(),
  scenarioIds: z.array(id).optional(),
});

export const documentBody = z.object({
  kind: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  format: contentFormat.optional(),
  content: z.string().max(CONTENT_MAX_BYTES, "document.content exceeds 100KB").optional(),
});

// Events: append-only POST. All fields required (an event is never a partial patch);
// zod enforces structure, the service layer enforces cross-document rules (criterion <= max).
export const scoreBody = z.object({
  scenarioId: id,
  taskId: id,
  commitSha: id.optional(),
  criteria: z.record(z.string(), z.number().int().min(0)),
  composite: z.number().min(0).max(100),
  by: z.string().min(1).optional(),
  note: z.string().optional(),
});

export const testRunBody = z.object({
  scenarioId: id,
  taskId: id,
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  issues: z.array(z.string()).optional(),
});

export const revisionBody = z.object({
  trigger: z.object({ scenarioId: id, reason: z.string().min(1) }),
  // changes carry op + taskId plus optional op-specific detail (title/order/...). passthrough
  // keeps that detail; the loop, not Daloop, defines its meaning.
  changes: z.array(z.object({ op: z.enum(["add", "replace", "reorder", "drop"]), taskId: id }).passthrough()).min(1),
});

export type GoalBody = z.infer<typeof goalBody>;
export type ScenarioBody = z.infer<typeof scenarioBody>;
export type TaskBody = z.infer<typeof taskBody>;
export type DocumentBody = z.infer<typeof documentBody>;
export type ScoreBody = z.infer<typeof scoreBody>;
export type TestRunBody = z.infer<typeof testRunBody>;
export type RevisionBody = z.infer<typeof revisionBody>;

export const keyMintBody = z.object({
  label: z.string().trim().min(1).max(100),
});
export type KeyMintBody = z.infer<typeof keyMintBody>;
