import { describe, it, expect } from "vitest";
import { computeCurrentPhaseId, computeCurrentTaskId, computeCurrentLoopId } from "../src/derive.js";

describe("computeCurrentPhaseId", () => {
  it("picks the lowest-order non-terminal phase; tiebreak by id", () => {
    expect(computeCurrentPhaseId([
      { id: "b", order: 2, status: "running" },
      { id: "a", order: 1, status: "running" },
    ])).toBe("a");
    expect(computeCurrentPhaseId([
      { id: "y", order: 1, status: "running" },
      { id: "x", order: 1, status: "running" },
    ])).toBe("x");
  });
  it("ignores terminal phases; null when all terminal", () => {
    expect(computeCurrentPhaseId([
      { id: "a", order: 1, status: "completed" },
      { id: "b", order: 2, status: "running" },
    ])).toBe("b");
    expect(computeCurrentPhaseId([{ id: "a", order: 1, status: "failed" }])).toBeNull();
  });
});

describe("computeCurrentTaskId", () => {
  const tasks = [
    { id: "t2", phaseId: "p1", order: 2, status: "queued" as const },
    { id: "t1", phaseId: "p1", order: 1, status: "running" as const },
    { id: "t3", phaseId: "p2", order: 1, status: "running" as const },
  ];
  it("picks the lowest-order non-terminal task within the current phase", () => {
    expect(computeCurrentTaskId("p1", tasks)).toBe("t1");
    expect(computeCurrentTaskId("p2", tasks)).toBe("t3");
  });
  it("is null when there is no current phase or no non-terminal task there", () => {
    expect(computeCurrentTaskId(null, tasks)).toBeNull();
    expect(computeCurrentTaskId("p1", [{ id: "t1", phaseId: "p1", order: 1, status: "completed" }])).toBeNull();
  });
});

describe("computeCurrentLoopId", () => {
  it("lowest-order non-terminal loop; tiebreak id; null when all terminal/empty", () => {
    expect(computeCurrentLoopId([{ id: "b", order: 2, status: "running" }, { id: "a", order: 1, status: "running" }])).toBe("a");
    expect(computeCurrentLoopId([{ id: "a", order: 1, status: "completed" }, { id: "b", order: 2, status: "running" }])).toBe("b");
    expect(computeCurrentLoopId([{ id: "a", order: 1, status: "failed" }])).toBeNull();
    expect(computeCurrentLoopId([])).toBeNull();
  });
});
