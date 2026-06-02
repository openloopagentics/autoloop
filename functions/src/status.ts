export const STATUSES = [
  "queued", "running", "blocked", "paused", "completed", "failed", "cancelled",
] as const;

export type Status = (typeof STATUSES)[number];

const TERMINAL = new Set<Status>(["completed", "failed", "cancelled"]);

export function isTerminal(status: Status): boolean {
  return TERMINAL.has(status);
}
