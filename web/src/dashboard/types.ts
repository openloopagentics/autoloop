export interface TeamRef { teamId: string; role: string; }
export interface Team { name?: string; }
export interface Project { slug: string; title?: string; status?: string; currentPhaseId?: string | null; design?: { format: "markdown" | "url"; content: string } | null; }
export interface Phase { name?: string; order?: number; status?: string; startedAt?: unknown; endedAt?: unknown; }
export interface Commit { sha: string; message?: string; author?: string; committedAt?: unknown; }
