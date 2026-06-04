export interface TeamRef { teamId: string; role: string; }
export interface Team { name?: string; }
export interface Project { slug: string; title?: string; status?: string; visionOwner?: "web" | "loop"; currentPhaseId?: string | null; currentTaskId?: string | null; design?: { format: "markdown" | "url"; content: string } | null; }

export interface Loop {
  id: string; goal?: string; name?: string; order?: number; status?: string;
  startedAt?: unknown; endedAt?: unknown;
  currentPhaseId?: string | null; currentTaskId?: string | null;
}
export interface Phase { id?: string; name?: string; order?: number; status?: string; startedAt?: unknown; endedAt?: unknown; }
export interface Commit { sha: string; message?: string; author?: string; committedAt?: unknown; }

export interface RubricCriterion { id: string; name: string; weight: number; max: number; }
export interface Goal { id: string; title?: string; description?: string; order?: number; }
export interface Scenario {
  id: string; goalId?: string; title?: string; description?: string; order?: number;
  threshold?: number; rubric?: { criteria: RubricCriterion[] };
}
export interface Task { id: string; phaseId?: string; title?: string; order?: number; status?: string; scenarioIds?: string[]; }
export interface Score { id: string; scenarioId?: string; taskId?: string; criteria?: Record<string, number>; composite?: number; by?: string; note?: string; commitSha?: string; }
export interface TestRun { id: string; scenarioId?: string; taskId?: string; passed?: number; failed?: number; issues?: string[]; }
export interface RevisionChange { op: string; taskId: string; [k: string]: unknown; }
export interface Revision { id: string; trigger?: { scenarioId?: string; reason?: string }; changes?: RevisionChange[]; }
export interface DocumentRec { id: string; kind?: string; title?: string; format?: "markdown" | "url"; content?: string; }
