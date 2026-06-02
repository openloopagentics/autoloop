import { describe, it, expect } from "vitest";
import { STATUSES, isTerminal } from "../src/status.js";

describe("status", () => {
  it("lists all seven statuses", () => {
    expect(STATUSES).toEqual([
      "queued", "running", "blocked", "paused", "completed", "failed", "cancelled",
    ]);
  });

  it("treats completed/failed/cancelled as terminal", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });

  it("treats queued/running/blocked/paused as non-terminal", () => {
    for (const s of ["queued", "running", "blocked", "paused"] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});
