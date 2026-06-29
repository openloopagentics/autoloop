import { describe, it, expect } from "vitest";
import { explainScenario, toDecisions, buildWhyModel } from "./whyModel";
import type { Scenario, Score, TestRun, Verification, Revision, VisionChange, Decision, Idea, Goal, Task, Bug } from "./types";

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

describe("toDecisions", () => {
  const loopId = "L1";
  it("maps a revision to a plan-change with refs from trigger + changes", () => {
    const rev: Revision = { id: "R1", trigger: { scenarioId: "s1", reason: "rough UX" }, changes: [{ op: "add", taskId: "t9" }] };
    const out = toDecisions({ loopId, decisions: [], revisions: [rev], visionChanges: [], ideas: [] });
    const d = out.find((x) => x.source === "revision")!;
    expect(d.kind).toBe("plan-change");
    expect(d.rationale).toBe("rough UX");
    expect(d.refs.scenarioIds).toContain("s1");
    expect(d.refs.taskIds).toContain("t9");
  });
  it("maps a visionChange to a vision-change", () => {
    const vc: VisionChange = { id: "V1", op: "upsert-scenario", targetId: "s2", reason: "missing edge case" };
    const out = toDecisions({ loopId, decisions: [], revisions: [], visionChanges: [vc], ideas: [] });
    expect(out.find((x) => x.source === "visionChange")).toMatchObject({ kind: "vision-change", rationale: "missing edge case" });
  });
  it("passes through a real decision record", () => {
    const dec: Decision = { id: "D1", kind: "goal-pick", summary: "s", rationale: "r" };
    expect(toDecisions({ loopId, decisions: [dec], revisions: [], visionChanges: [], ideas: [] }).find((x) => x.source === "decision")).toMatchObject({ kind: "goal-pick" });
  });
  it("synthesizes a goal-pick from the seeding idea only when no goal-pick decision exists", () => {
    const idea: Idea = { id: "I1", title: "Checkout", rationale: "top theme", status: "accepted", builtInLoopId: "L1" };
    const synth = toDecisions({ loopId, decisions: [], revisions: [], visionChanges: [], ideas: [idea] });
    expect(synth.find((x) => x.source === "synthesized")).toMatchObject({ kind: "goal-pick" });
    const withReal = toDecisions({ loopId, decisions: [{ id: "D1", kind: "goal-pick", summary: "s", rationale: "r" }], revisions: [], visionChanges: [], ideas: [idea] });
    expect(withReal.some((x) => x.source === "synthesized")).toBe(false);
  });
});

describe("buildWhyModel", () => {
  const base = {
    loopId: "L1",
    goals: [{ id: "g1", title: "Resilient checkout" }] as Goal[],
    scenarios: [{ id: "s1", goalId: "g1", title: "Retry", threshold: 80 }] as Scenario[],
    tasks: [{ id: "t1", title: "Backoff", scenarioIds: ["s1"], loopId: "L1" }] as Task[],
    bugs: [] as Bug[],
    scores: [{ id: "A", scenarioId: "s1", composite: 72 }] as Score[],
    testRuns: [{ id: "A", scenarioId: "s1", failed: 0 }] as TestRun[],
    verifications: [] as Verification[],
    revisions: [{ id: "R1", trigger: { scenarioId: "s1", reason: "low" }, changes: [{ op: "add", taskId: "t1" }] }] as Revision[],
    visionChanges: [] as VisionChange[],
    decisions: [] as Decision[],
    ideas: [] as Idea[],
  };
  it("builds subjects with namespaced ids and a scenario explanation", () => {
    const m = buildWhyModel(base);
    const s = m.subjects.find((x) => x.id === "scenario:s1")!;
    expect(s.kind).toBe("scenario");
    expect(s.explanation?.state).toBe("unmet");      // 72 < 80
  });
  it("emits structure edges goal→scenario→task", () => {
    const m = buildWhyModel(base);
    expect(m.edges).toContainEqual({ type: "structure", from: "goal:g1", to: "scenario:s1" });
    expect(m.edges).toContainEqual({ type: "structure", from: "scenario:s1", to: "task:t1" });
  });
  it("emits an affects edge from a decision to its referenced subjects", () => {
    const m = buildWhyModel(base);
    expect(m.edges.some((e) => e.type === "affects" && e.to === "scenario:s1")).toBe(true);
  });
  it("drops dangling refs (no edge to a non-existent subject)", () => {
    const m = buildWhyModel({ ...base, decisions: [{ id: "D1", kind: "approach", summary: "x", rationale: "y", refs: { taskIds: ["ghost"] } }] });
    expect(m.edges.some((e) => e.to === "task:ghost")).toBe(false);
  });
  it("turns scores/testRuns into evidence rows linked to the scenario", () => {
    const m = buildWhyModel(base);
    expect(m.evidence.some((e) => e.kind === "score" && e.subjectId === "scenario:s1" && e.relation === "supports")).toBe(true);
  });
  it("flips a scenario subject to 'bugged' when a high-severity open bug is linked", () => {
    const m = buildWhyModel({ ...base, bugs: [{ id: "b1", scenarioId: "s1", severity: "high", status: "open" }] });
    expect(m.subjects.find((x) => x.id === "scenario:s1")!.explanation?.state).toBe("bugged");
  });
  it("does NOT flip a scenario to 'bugged' for a fixed or low-severity bug", () => {
    const fixed = buildWhyModel({ ...base, bugs: [{ id: "b1", scenarioId: "s1", severity: "high", status: "fixed" }] });
    expect(fixed.subjects.find((x) => x.id === "scenario:s1")!.explanation?.state).not.toBe("bugged");
    const low = buildWhyModel({ ...base, bugs: [{ id: "b2", scenarioId: "s1", severity: "low", status: "open" }] });
    expect(low.subjects.find((x) => x.id === "scenario:s1")!.explanation?.state).not.toBe("bugged");
  });
  it("produces a 'refutes' evidence row from a refuted verification", () => {
    const m = buildWhyModel({ ...base, verifications: [{ id: "V1", scenarioId: "s1", verdict: "refuted" }] });
    expect(m.evidence.some((e) => e.kind === "verification" && e.subjectId === "scenario:s1" && e.relation === "refutes")).toBe(true);
  });
});
