import { describe, it, expect } from "vitest";
import { latestById, summarize, scenarioStatus } from "./scenarioState";
import type { Scenario, Score, TestRun, Verification } from "./types";

const scenario = (over: Partial<Scenario> = {}): Scenario => ({ id: "s1", goalId: "g1", title: "S", rubric: { criteria: [] }, ...over });
const score = (id: string, composite: number, scenarioId = "s1"): Score => ({ id, scenarioId, composite });
const run = (id: string, failed: number, scenarioId = "s1"): TestRun => ({ id, scenarioId, passed: 1, failed });

describe("latestById", () => {
  it("returns the lexical-max id, regardless of array order", () => {
    expect(latestById([score("01B", 1), score("01A", 2), score("01C", 3)])!.id).toBe("01C");
    expect(latestById([])).toBeNull();
  });
});

describe("summarize", () => {
  it("counts met / total", () => {
    const scns = [scenario({ id: "s1" }), scenario({ id: "s2" })];
    const scores = [score("01A", 90, "s1"), score("01A", 10, "s2")];
    const runs = [run("01A", 0, "s1"), run("01A", 0, "s2")];
    expect(summarize(scns, scores, runs, [])).toEqual({ met: 1, total: 2 });
  });
});

const scn: Scenario = { id: "s1", threshold: 80 };
const scoreV = (id: string, c: number): Score => ({ id, scenarioId: "s1", composite: c });
const runV = (id: string, f: number): TestRun => ({ id, scenarioId: "s1", failed: f });
const ver = (id: string, v: "confirmed" | "refuted"): Verification => ({ id, scenarioId: "s1", verdict: v });

describe("scenarioStatus", () => {
  it("met when score>=threshold, no fails, not refuted", () => {
    const r = scenarioStatus(scn, [scoreV("A", 90)], [runV("A", 0)], []);
    expect(r.state).toBe("met");
    expect(r.latestComposite).toBe(90);
    expect(r.reasons.every((x) => x.ok)).toBe(true);
  });
  it("unmet + refutation reason when refuted despite high score", () => {
    const r = scenarioStatus(scn, [scoreV("A", 95)], [runV("A", 0)], [ver("A", "refuted")]);
    expect(r.state).toBe("unmet");
    expect(r.reasons.find((x) => x.kind === "verification")?.ok).toBe(false);
  });
});
describe("summarize (verification-aware)", () => {
  it("counts a refuted-but-high scenario as unmet", () => {
    const r = summarize([scn], [scoreV("A", 95)], [runV("A", 0)], [ver("A", "refuted")]);
    expect(r).toEqual({ met: 0, total: 1 });
  });
});
