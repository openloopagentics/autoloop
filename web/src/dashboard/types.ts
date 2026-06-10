export interface TeamRef { teamId: string; role: string; }
export interface Team { name?: string; }
export interface Project { slug: string; title?: string; status?: string; visionOwner?: "web" | "loop"; currentPhaseId?: string | null; currentTaskId?: string | null; currentLoopId?: string | null; design?: { format: "markdown" | "url"; content: string } | null; }

export interface Loop {
  id: string; goal?: string; name?: string; order?: number; status?: string;
  startedAt?: unknown; endedAt?: unknown;
  currentPhaseId?: string | null; currentTaskId?: string | null;
}
export interface Phase { id?: string; name?: string; order?: number; status?: string; startedAt?: unknown; endedAt?: unknown; }
export interface CommitTokens { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; }
export interface Commit { sha: string; message?: string; author?: string; committedAt?: unknown; tokens?: CommitTokens; }

export interface RubricCriterion { id: string; name: string; weight: number; max: number; }
export interface Goal { id: string; title?: string; description?: string; order?: number; }
export interface Scenario {
  id: string; goalId?: string; title?: string; description?: string; order?: number;
  threshold?: number; rubric?: { criteria: RubricCriterion[] };
}
export interface Task { id: string; phaseId?: string; title?: string; order?: number; status?: string; scenarioIds?: string[]; }
export interface Score { id: string; scenarioId?: string; taskId?: string; criteria?: Record<string, number>; composite?: number; by?: string; note?: string; commitSha?: string; }
export interface TestRun { id: string; scenarioId?: string; taskId?: string; passed?: number; failed?: number; issues?: string[]; summary?: string; loopId?: string; }
export interface Verification {
  id: string; scenarioId?: string; taskId?: string; testRunId?: string;
  verdict?: "confirmed" | "refuted"; summary?: string; by?: string; createdAt?: unknown;
}
export interface RevisionChange { op: string; taskId: string; [k: string]: unknown; }
export interface Revision { id: string; trigger?: { scenarioId?: string; reason?: string }; changes?: RevisionChange[]; }
export interface DocumentRec { id: string; kind?: string; title?: string; format?: "markdown" | "url"; content?: string; }
export interface Bug {
  id: string; title?: string; description?: string; scenarioId?: string; taskId?: string;
  severity?: "low" | "medium" | "high"; status?: "open" | "fixed";
  createdAt?: unknown; updatedAt?: unknown; fixedAt?: unknown;
  loopId?: string; // client-attached: which loop the bug came from (undefined = project-direct)
}
export interface Idea {
  id: string; title?: string; rationale?: string;
  status?: "proposed" | "accepted" | "rejected" | "done"; order?: number;
  by?: "agent" | "user"; originLoopId?: string; builtInLoopId?: string;
  createdAt?: unknown; updatedAt?: unknown; decidedAt?: unknown;
}
export interface Message { id: string; text: string; author: "user" | "agent"; status?: "pending" | "delivered"; createdAt?: unknown; deliveredAt?: unknown; }

export type SessionEntry =
  | { kind: "user";      text: string; ts: number }
  | { kind: "assistant"; text: string; ts: number }
  | { kind: "tool";      name: string; summary: string; ok: boolean; ts: number };

export interface SessionDoc {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  entries: SessionEntry[];
}
