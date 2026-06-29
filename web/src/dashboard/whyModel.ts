import { latestById, DEFAULT_THRESHOLD } from "./scenarioState";
import type { Scenario, Score, TestRun, Verification } from "./types";

export type SubjectState = "met" | "unmet" | "neutral" | "active" | "bugged";

export interface ExplanationReason {
  kind: "score" | "test" | "verification" | "missing";
  ok: boolean;
  text: string;
  evidenceId?: string;
}
export interface Explanation {
  state: SubjectState;
  reasons: ExplanationReason[];
}

/**
 * Why a scenario is met/unmet, per the CANONICAL 3-condition rule (docs/concepts.md):
 * score ≥ threshold AND latest test failed === 0 AND latest verification not refuted.
 * This is verification-aware on purpose — it corrects the legacy 2-condition
 * deriveScenarioState (SP2 consolidates onto this).
 */
export function explainScenario(
  scenario: Scenario,
  scores: Score[],
  testRuns: TestRun[],
  verifications: Verification[],
): Explanation {
  const latestScore = latestById(scores.filter((s) => s.scenarioId === scenario.id));
  const latestTest = latestById(testRuns.filter((r) => r.scenarioId === scenario.id));
  const latestVer = latestById(verifications.filter((v) => v.scenarioId === scenario.id));
  const threshold = scenario.threshold ?? DEFAULT_THRESHOLD;
  const reasons: ExplanationReason[] = [];

  if (latestScore?.composite == null) {
    reasons.push({ kind: "missing", ok: false, text: "no score yet" });
  } else {
    const ok = latestScore.composite >= threshold;
    const crit = latestScore.criteria
      ? ` (${Object.entries(latestScore.criteria).map(([k, v]) => `${k} ${v}`).join(", ")})`
      : "";
    const note = latestScore.note ? ` · note: ${latestScore.note}` : "";
    reasons.push({ kind: "score", ok, text: `score ${latestScore.composite} ${ok ? "≥" : "<"} threshold ${threshold}${crit}${note}`, evidenceId: latestScore.id });
  }

  if (!latestTest) {
    reasons.push({ kind: "missing", ok: false, text: "no test run yet" });
  } else {
    const failed = latestTest.failed ?? 0;
    const ok = failed === 0;
    const issues = latestTest.issues?.length ? ` (${latestTest.issues.join("; ")})` : "";
    reasons.push({ kind: "test", ok, text: ok ? "all tests passing" : `${failed} test(s) failing${issues}`, evidenceId: latestTest.id });
  }

  if (latestVer?.verdict === "refuted") {
    reasons.push({ kind: "verification", ok: false, text: latestVer.summary ? `refuted: ${latestVer.summary}` : "refuted by verification", evidenceId: latestVer.id });
  } else if (latestVer?.verdict === "confirmed") {
    reasons.push({ kind: "verification", ok: true, text: "verification confirmed", evidenceId: latestVer.id });
  }

  const state: SubjectState = reasons.every((r) => r.ok) ? "met" : "unmet";
  reasons.sort((a, b) => Number(a.ok) - Number(b.ok)); // failing reasons first
  return { state, reasons };
}

import type { Revision, VisionChange, Decision, Idea } from "./types";

export type DecisionKind = "goal-pick" | "approach" | "stuck" | "plan-change" | "vision-change";

export interface WhyDecision {
  id: string;
  kind: DecisionKind;
  loopId?: string;
  summary: string;
  rationale: string;
  alternatives?: string[];
  refs: { scenarioIds: string[]; taskIds: string[]; commitShas: string[] };
  source: "decision" | "revision" | "visionChange" | "synthesized";
}

interface DecisionInputs {
  loopId?: string;
  decisions: Decision[];
  revisions: Revision[];
  visionChanges: VisionChange[];
  ideas: Idea[];
}

const emptyRefs = () => ({ scenarioIds: [] as string[], taskIds: [] as string[], commitShas: [] as string[] });

export function toDecisions(inp: DecisionInputs): WhyDecision[] {
  const out: WhyDecision[] = [];

  for (const d of inp.decisions) {
    out.push({
      id: d.id, kind: (d.kind ?? "approach") as DecisionKind, loopId: inp.loopId,
      summary: d.summary ?? "", rationale: d.rationale ?? "", alternatives: d.alternatives,
      refs: { scenarioIds: d.refs?.scenarioIds ?? [], taskIds: d.refs?.taskIds ?? [], commitShas: d.refs?.commitShas ?? [] },
      source: "decision",
    });
  }

  for (const r of inp.revisions) {
    const refs = emptyRefs();
    if (r.trigger?.scenarioId) refs.scenarioIds.push(r.trigger.scenarioId);
    for (const c of r.changes ?? []) if (c.taskId) refs.taskIds.push(c.taskId);
    out.push({
      id: r.id, kind: "plan-change", loopId: inp.loopId,
      summary: (r.changes ?? []).map((c) => `${c.op} ${c.taskId}`).join(", ") || "plan change",
      rationale: r.trigger?.reason ?? "", refs, source: "revision",
    });
  }

  for (const v of inp.visionChanges) {
    out.push({
      id: v.id, kind: "vision-change", loopId: v.originLoopId ?? inp.loopId,
      summary: `${v.op ?? "change"} ${v.targetId ?? ""}`.trim(), rationale: v.reason ?? "",
      refs: { ...emptyRefs(), scenarioIds: v.targetId ? [v.targetId] : [] }, source: "visionChange",
    });
  }

  // Synthesize a goal-pick from the idea that seeded THIS loop, only if the driver
  // didn't emit one. source:"synthesized" lets a surface render it faintly.
  const hasGoalPick = out.some((d) => d.kind === "goal-pick");
  if (!hasGoalPick) {
    const seed = inp.ideas.find((i) => i.builtInLoopId === inp.loopId && i.status !== "rejected");
    if (seed) {
      out.push({
        id: `synth:${seed.id}`, kind: "goal-pick", loopId: inp.loopId,
        summary: seed.title ?? "goal", rationale: seed.rationale ?? "", refs: emptyRefs(), source: "synthesized",
      });
    }
  }
  return out;
}
