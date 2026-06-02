const COLORS: Record<string, string> = {
  queued: "gray", running: "blue", blocked: "red", paused: "amber",
  completed: "green", failed: "red", cancelled: "gray",
};

export function statusColor(status: string): string {
  return COLORS[status] ?? "gray";
}
