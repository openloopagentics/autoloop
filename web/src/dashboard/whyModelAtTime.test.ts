import { describe, it, expect } from "vitest";
import { tsMillis, whyModelAtTime } from "./whyModelAtTime";
import type { BuildWhyModelInput } from "./whyModel";
import type { Bug, Decision, Goal, Idea, Revision, Scenario, Score, Task, TestRun, Verification, VisionChange } from "./types";

describe("tsMillis", () => {
  it("returns a number directly", () => {
    expect(tsMillis(100)).toBe(100);
  });
  it("calls toMillis() on Firestore Timestamp-like objects", () => {
    expect(tsMillis({ toMillis: () => 500 })).toBe(500);
  });
  it("returns null for absent/unknown values", () => {
    expect(tsMillis(undefined)).toBeNull();
    expect(tsMillis(null)).toBeNull();
    expect(tsMillis("not a ts")).toBeNull();
  });
});

// Base input: score at t=100 (unmet, composite 72), later score at t=400 (met, composite 90),
// decision at t=100 (early) and t=300 (late).
const baseInput: BuildWhyModelInput = {
  loopId: "L1",
  goals: [{ id: "g1", title: "Goal" }] as Goal[],
  scenarios: [{ id: "s1", goalId: "g1", title: "Scenario", threshold: 80 }] as Scenario[],
  tasks: [{ id: "t1", title: "Task", scenarioIds: ["s1"], loopId: "L1", createdAt: 100 }] as Task[],
  bugs: [] as Bug[],
  scores: [
    { id: "sc1", scenarioId: "s1", composite: 72, createdAt: 100 },
    { id: "sc2", scenarioId: "s1", composite: 90, createdAt: 400 },
  ] as Score[],
  testRuns: [{ id: "tr1", scenarioId: "s1", failed: 0, createdAt: 100 }] as TestRun[],
  verifications: [] as Verification[],
  revisions: [] as Revision[],
  visionChanges: [] as VisionChange[],
  decisions: [
    { id: "D1", kind: "approach", summary: "early", rationale: "r", createdAt: 100 } as Decision,
    { id: "D2", kind: "approach", summary: "late", rationale: "r", createdAt: 300 } as Decision,
  ],
  ideas: [] as Idea[],
};

describe("whyModelAtTime", () => {
  it("excludes decisions created after cutoff", () => {
    const m = whyModelAtTime(baseInput, 200);
    expect(m.decisions.some((d) => d.summary === "late")).toBe(false);
    expect(m.decisions.some((d) => d.summary === "early")).toBe(true);
  });
  it("excludes scores created after cutoff; scenario state reflects remaining data only", () => {
    // at cutoff=200 only sc1 (t=100, composite 72 < 80) is included → scenario is unmet
    const m = whyModelAtTime(baseInput, 200);
    const s1 = m.subjects.find((s) => s.id === "scenario:s1");
    expect(s1?.explanation?.state).toBe("unmet");
    // at cutoff=500 both scores are included → sc2 (composite 90) is latest → met
    const mAll = whyModelAtTime(baseInput, 500);
    const s1All = mAll.subjects.find((s) => s.id === "scenario:s1");
    expect(s1All?.explanation?.state).toBe("met");
  });
  it("keeps goals and scenarios (vision) regardless of cutoff", () => {
    const m = whyModelAtTime(baseInput, 0);
    expect(m.subjects.some((s) => s.id === "goal:g1")).toBe(true);
    expect(m.subjects.some((s) => s.id === "scenario:s1")).toBe(true);
  });
  it("items with null createdAt (missing timestamp) are always included", () => {
    const input: BuildWhyModelInput = {
      ...baseInput,
      decisions: [{ id: "D1", kind: "approach", summary: "no-ts", rationale: "r" } as Decision],
    };
    const m = whyModelAtTime(input, 0);
    expect(m.decisions.some((d) => d.summary === "no-ts")).toBe(true);
  });
});
