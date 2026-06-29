import { describe, it, expect } from "vitest";
import { explainScenario } from "./whyModel";
import type { Scenario, Score, TestRun, Verification } from "./types";

const scn: Scenario = { id: "s1", threshold: 80 };
const score = (id: string, composite: number): Score => ({ id, scenarioId: "s1", composite });
const test = (id: string, failed: number): TestRun => ({ id, scenarioId: "s1", failed });
const ver = (id: string, verdict: "confirmed" | "refuted"): Verification => ({ id, scenarioId: "s1", verdict });

describe("explainScenario", () => {
  it("met when score ≥ threshold, no test failures, not refuted", () => {
    const e = explainScenario(scn, [score("A", 90)], [test("A", 0)], []);
    expect(e.state).toBe("met");
    expect(e.reasons.every((r) => r.ok)).toBe(true);
  });
  it("unmet with a score reason when composite < threshold", () => {
    const e = explainScenario(scn, [score("A", 72)], [test("A", 0)], []);
    expect(e.state).toBe("unmet");
    expect(e.reasons[0]).toMatchObject({ kind: "score", ok: false });
    expect(e.reasons[0].text).toContain("72");
    expect(e.reasons[0].text).toContain("80");
  });
  it("unmet when latest test has failures", () => {
    const e = explainScenario(scn, [score("A", 90)], [test("A", 2)], []);
    expect(e.state).toBe("unmet");
    expect(e.reasons.find((r) => r.kind === "test")).toMatchObject({ ok: false });
  });
  it("unmet when refuted, even with a high score and passing tests", () => {
    const e = explainScenario(scn, [score("A", 95)], [test("A", 0)], [ver("A", "refuted")]);
    expect(e.state).toBe("unmet");
    expect(e.reasons.find((r) => r.kind === "verification")).toMatchObject({ ok: false });
  });
  it("met is unaffected by a confirmed verification", () => {
    expect(explainScenario(scn, [score("A", 90)], [test("A", 0)], [ver("A", "confirmed")]).state).toBe("met");
  });
  it("unmet with a 'missing' reason when there is no test run", () => {
    const e = explainScenario(scn, [score("A", 90)], [], []);
    expect(e.state).toBe("unmet");
    expect(e.reasons.some((r) => r.kind === "missing")).toBe(true);
  });
});
