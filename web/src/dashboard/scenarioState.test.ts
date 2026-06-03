import { describe, it, expect } from "vitest";
import { deriveScenarioState, latestById, summarize } from "./scenarioState";
import type { Scenario, Score, TestRun } from "./types";

const scenario = (over: Partial<Scenario> = {}): Scenario => ({ id: "s1", goalId: "g1", title: "S", rubric: { criteria: [] }, ...over });
const score = (id: string, composite: number, scenarioId = "s1"): Score => ({ id, scenarioId, composite });
const run = (id: string, failed: number, scenarioId = "s1"): TestRun => ({ id, scenarioId, passed: 1, failed });

describe("latestById", () => {
  it("returns the lexical-max id, regardless of array order", () => {
    expect(latestById([score("01B", 1), score("01A", 2), score("01C", 3)])!.id).toBe("01C");
    expect(latestById([])).toBeNull();
  });
});

describe("deriveScenarioState", () => {
  it("met: latest composite >= threshold AND latest testRun.failed === 0", () => {
    const r = deriveScenarioState(scenario({ threshold: 80 }), [score("01A", 60), score("01B", 85)], [run("01A", 0)]);
    expect(r.state).toBe("met");
    expect(r.latestComposite).toBe(85);
  });
  it("unmet when latest composite < threshold", () => {
    expect(deriveScenarioState(scenario({ threshold: 80 }), [score("01A", 79)], [run("01A", 0)]).state).toBe("unmet");
  });
  it("unmet when latest testRun has failures", () => {
    expect(deriveScenarioState(scenario({ threshold: 80 }), [score("01A", 95)], [run("01A", 2)]).state).toBe("unmet");
  });
  it("met exactly at the threshold", () => {
    expect(deriveScenarioState(scenario({ threshold: 80 }), [score("01A", 80)], [run("01A", 0)]).state).toBe("met");
  });
  it("defaults threshold to 80 when unset", () => {
    expect(deriveScenarioState(scenario({ threshold: undefined }), [score("01A", 80)], [run("01A", 0)]).state).toBe("met");
    expect(deriveScenarioState(scenario({ threshold: undefined }), [score("01A", 79)], [run("01A", 0)]).state).toBe("unmet");
  });
  it("unmet when there is no score or no test run", () => {
    expect(deriveScenarioState(scenario(), [], [run("01A", 0)]).state).toBe("unmet");
    expect(deriveScenarioState(scenario(), [score("01A", 90)], []).state).toBe("unmet");
  });
  it("ignores other scenarios' scores/runs", () => {
    const r = deriveScenarioState(scenario(), [score("01A", 90), score("01Z", 10, "other")], [run("01A", 0)]);
    expect(r.latestComposite).toBe(90);
    expect(r.state).toBe("met");
  });
});

describe("summarize", () => {
  it("counts met / total", () => {
    const scns = [scenario({ id: "s1" }), scenario({ id: "s2" })];
    const scores = [score("01A", 90, "s1"), score("01A", 10, "s2")];
    const runs = [run("01A", 0, "s1"), run("01A", 0, "s2")];
    expect(summarize(scns, scores, runs)).toEqual({ met: 1, total: 2 });
  });
});
