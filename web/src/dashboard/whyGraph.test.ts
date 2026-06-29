import { describe, it, expect } from "vitest";
import { buildWhyGraph } from "./whyGraph";
import { buildWhyModel } from "./whyModel";
import type { WhyModel } from "./whyModel";
import type { Bug, Decision, Goal, Idea, Revision, Scenario, Score, Task, TestRun, Verification, VisionChange } from "./types";

// Build a small WhyModel:
//   goal g1 → scenario s1 (unmet, score 72 < threshold 80) → task t1
//   plan-change revision R1 references task t1
//   score evidence sc1 on scenario s1
const model: WhyModel = buildWhyModel({
  loopId: "L1",
  goals: [{ id: "g1", title: "Resilient checkout" }] as Goal[],
  scenarios: [{ id: "s1", goalId: "g1", title: "Retry", threshold: 80 }] as Scenario[],
  tasks: [{ id: "t1", title: "Backoff", scenarioIds: ["s1"], loopId: "L1" }] as Task[],
  bugs: [] as Bug[],
  scores: [{ id: "sc1", scenarioId: "s1", composite: 72 }] as Score[],
  testRuns: [{ id: "tr1", scenarioId: "s1", failed: 0 }] as TestRun[],
  verifications: [] as Verification[],
  revisions: [{ id: "R1", trigger: { scenarioId: "s1", reason: "low score" }, changes: [{ op: "add", taskId: "t1" }] }] as Revision[],
  visionChanges: [] as VisionChange[],
  decisions: [] as Decision[],
  ideas: [] as Idea[],
});

// A second model with a met scenario (no whyChip expected)
const metModel: WhyModel = buildWhyModel({
  loopId: "L2",
  goals: [{ id: "g2", title: "Goal" }] as Goal[],
  scenarios: [{ id: "s2", goalId: "g2", title: "Met scenario", threshold: 80 }] as Scenario[],
  tasks: [] as Task[],
  bugs: [] as Bug[],
  scores: [{ id: "sc2", scenarioId: "s2", composite: 90 }] as Score[],
  testRuns: [{ id: "tr2", scenarioId: "s2", failed: 0 }] as TestRun[],
  verifications: [] as Verification[],
  revisions: [] as Revision[],
  visionChanges: [] as VisionChange[],
  decisions: [] as Decision[],
  ideas: [] as Idea[],
});

const d = buildWhyGraph(model, { showReasoning: false });
const r = buildWhyGraph(model, { showReasoning: true });

describe("buildWhyGraph — default mode", () => {
  it("default: only structural node kinds", () => {
    expect(d.nodes.map((n) => n.kind).sort()).toEqual(["goal", "scenario", "task"]);
  });
  it("default: scenario carries a whyChip = top failing reason", () => {
    expect(d.nodes.find((n) => n.id === "scenario:s1")?.whyChip).toContain("72");
  });
  it("default: a decision collapses onto the target's incoming structure edge label", () => {
    const e = d.edges.find((x) => x.from === "scenario:s1" && x.to === "task:t1");
    expect(e?.label).toBeTruthy(); // the plan-change summary
  });
  it("default: no decision/evidence nodes or affects/evidence edges", () => {
    expect(d.nodes.some((n) => n.kind === "decision" || n.kind === "evidence")).toBe(false);
    expect(d.edges.some((e) => e.kind !== "structure")).toBe(false);
  });
});

describe("buildWhyGraph — reasoning mode", () => {
  it("reasoning: emits decision + evidence nodes and their edges", () => {
    expect(r.nodes.some((n) => n.kind === "decision")).toBe(true);
    expect(r.nodes.some((n) => n.kind === "evidence")).toBe(true);
    expect(r.edges.some((e) => e.kind === "affects")).toBe(true);
    expect(r.edges.some((e) => e.kind === "evidence")).toBe(true);
  });
  it("met scenario has no whyChip", () => {
    const met = buildWhyGraph(metModel, { showReasoning: false });
    expect(met.nodes.find((n) => n.id === "scenario:s2")?.whyChip).toBeUndefined();
  });
});
