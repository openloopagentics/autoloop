import { z } from "zod";
import { STATUSES } from "./status.js";

// URL-/Firestore-safe IDs (slug, phaseId, sha). No slashes — IDs are single path
// segments, so allow only lowercase alnum and . _ -
export const idPattern = /^[a-z0-9._-]+$/;

const status = z.enum(STATUSES);

const design = z.object({
  format: z.enum(["markdown", "url"]),
  content: z.string().max(100 * 1024, "design.content exceeds 100KB"),
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

export const keyMintBody = z.object({
  label: z.string().trim().min(1).max(100),
});
export type KeyMintBody = z.infer<typeof keyMintBody>;
