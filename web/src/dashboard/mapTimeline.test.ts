import { describe, it, expect } from "vitest";
import { mapAtTime, tsMillis } from "./mapTimeline";
import type { LoopSlice } from "./mapTimeline";

const goals = [{ id: "g1", title: "G", createdAt: 1000 }];
const scenarios = [{ id: "login", goalId: "g1", title: "Login", threshold: 80, createdAt: 1000 }];
const slices: LoopSlice[] = [
  { loopId: "l1",
    tasks: [{ id: "t1", title: "T1", status: "completed", scenarioIds: ["login"], createdAt: 2000 }],
    bugs: [{ id: "b1", title: "B1", status: "open", scenarioId: "login", createdAt: 2500 }],
    scores: [{ id: "01A", scenarioId: "login", composite: 90, createdAt: 3000 },
             { id: "01C", scenarioId: "login", composite: 50, createdAt: 5000 }],
    testRuns: [{ id: "01B", scenarioId: "login", passed: 1, failed: 0, createdAt: 3000 }] },
  { loopId: "l2",
    tasks: [{ id: "t1", title: "T1 again", status: "running", scenarioIds: ["login"], createdAt: 6000 }],
    bugs: [], scores: [], testRuns: [] },
];
const at = (cutoff: number) => mapAtTime({ goals, scenarios, slices, cutoff });
const ids = (g: ReturnType<typeof at>) => g.nodes.map((n) => n.id);

describe("tsMillis", () => {
  it("normalizes numbers, Timestamp-likes, and absent", () => {
    expect(tsMillis(42)).toBe(42);
    expect(tsMillis({ toMillis: () => 99 })).toBe(99);
    expect(tsMillis(undefined)).toBeNull();
  });
});

describe("mapAtTime entity cutoff", () => {
  it("filters entities to createdAt <= T", () => {
    const g = at(1500);
    expect(ids(g)).toContain("g:g1");
    expect(ids(g)).toContain("s:login");
    expect(ids(g).some((i) => i.startsWith("t:"))).toBe(false);
    expect(ids(g).some((i) => i.startsWith("b:"))).toBe(false);
  });
  it("includes entities with missing createdAt (legacy) at any T", () => {
    const g = mapAtTime({ goals: [{ id: "g0" }], scenarios: [], slices: [], cutoff: 1 });
    expect(ids(g)).toContain("g:g0");
  });
  it("merges all loops' tasks, loop-scoping colliding ids and tagging loopId", () => {
    const g = at(7000);
    const taskNodes = g.nodes.filter((n) => n.type === "task");
    expect(taskNodes).toHaveLength(2);                       // t1 from l1 AND t1 from l2
    expect(new Set(taskNodes.map((n) => n.id)).size).toBe(2); // no collision
    expect(taskNodes.map((n) => n.loopId).sort()).toEqual(["l1", "l2"]);
  });
});

describe("mapAtTime met-at-T (latest-by-ULID within cutoff)", () => {
  it("scenario unmet before any event, met after passing score+run, unmet after a later low score", () => {
    expect(at(2000).nodes.find((n) => n.id === "s:login")?.state).toBe("unmet");
    // at 3500: latest score within cutoff = 01A (90) + run failed 0... but b1 (open, no severity) is low → no bugged override
    expect(at(3500).nodes.find((n) => n.id === "s:login")?.state).toBe("met");
    expect(at(5500).nodes.find((n) => n.id === "s:login")?.state).toBe("unmet"); // 01C (50) is now latest
  });
});

describe("mapAtTime monotonic growth", () => {
  it("the node set only grows as T advances (goals/scenarios/tasks; no fixed bugs in fixture)", () => {
    const ts = [500, 1500, 2200, 2700, 4000, 6500];
    let prev = new Set<string>();
    for (const t of ts) {
      const cur = new Set(ids(at(t)));
      for (const id of prev) expect(cur.has(id)).toBe(true);
      prev = cur;
    }
    expect(prev.size).toBeGreaterThanOrEqual(5);
  });
});
