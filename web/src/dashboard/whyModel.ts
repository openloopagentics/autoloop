import { latestById, DEFAULT_THRESHOLD } from "./scenarioState";
import type { Scenario, Score, TestRun, Verification, Revision, VisionChange, Decision, Idea, Goal, Task, Bug } from "./types";

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

export type DecisionKind = "goal-pick" | "approach" | "stuck" | "plan-change" | "vision-change";

// `at` (chronological timestamp) and a required loopId are intentionally deferred to SP2:
// ULID event ids are already time-ordered, and createdAt availability varies across sources
// (revisions lack it in the web type). SP2 adds them when rendering/sorting needs them.
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
      refs: { ...emptyRefs(), scenarioIds: v.op === "upsert-scenario" && v.targetId ? [v.targetId] : [] }, source: "visionChange",
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

export type SubjectKind = "loop" | "goal" | "scenario" | "task" | "bug";

export interface WhySubject {
  id: string;
  kind: SubjectKind;
  label: string;
  loopId?: string;
  explanation?: Explanation;
}
export interface WhyEvidence {
  id: string;
  kind: "score" | "test-run" | "verification" | "commit";
  subjectId: string;
  relation: "supports" | "refutes";
  detail: Record<string, unknown>;
}
export type WhyEdge =
  | { type: "structure"; from: string; to: string }
  | { type: "affects"; from: string; to: string; decisionId: string }
  | { type: "evidence"; from: string; to: string; evidenceId: string };

export interface WhyModel {
  subjects: WhySubject[];
  decisions: WhyDecision[];
  evidence: WhyEvidence[];
  edges: WhyEdge[];
}

export interface BuildWhyModelInput extends DecisionInputs {
  goals: Goal[];
  scenarios: Scenario[];
  tasks: Task[];
  bugs: Bug[];
  scores: Score[];
  testRuns: TestRun[];
  verifications: Verification[];
  currentTaskId?: string | null;
}

const scen = (id: string) => `scenario:${id}`;
const task = (id: string) => `task:${id}`;

export function buildWhyModel(inp: BuildWhyModelInput): WhyModel {
  const subjects: WhySubject[] = [];
  const openBugs = inp.bugs.filter((b) => b.status !== "fixed");
  const buggedScenarios = new Set(openBugs.filter((b) => b.severity === "high" && b.scenarioId).map((b) => b.scenarioId as string));

  for (const g of inp.goals) subjects.push({ id: `goal:${g.id}`, kind: "goal", label: g.title ?? g.id });
  for (const s of inp.scenarios) {
    const ex = explainScenario(s, inp.scores, inp.testRuns, inp.verifications);
    subjects.push({ id: scen(s.id), kind: "scenario", label: s.title ?? s.id, explanation: buggedScenarios.has(s.id) ? { ...ex, state: "bugged" } : ex });
  }
  for (const t of inp.tasks) subjects.push({ id: task(t.id), kind: "task", label: t.title ?? t.id, loopId: t.loopId, explanation: { state: t.id === inp.currentTaskId ? "active" : "neutral", reasons: [] } });
  for (const b of openBugs) subjects.push({ id: `bug:${b.id}`, kind: "bug", label: b.title ?? b.id, loopId: b.loopId, explanation: { state: "bugged", reasons: [] } });

  const ids = new Set(subjects.map((s) => s.id));
  const edges: WhyEdge[] = [];
  const structure = (from: string, to: string) => { if (ids.has(from) && ids.has(to)) edges.push({ type: "structure", from, to }); };
  for (const s of inp.scenarios) if (s.goalId) structure(`goal:${s.goalId}`, scen(s.id));
  for (const t of inp.tasks) for (const sid of t.scenarioIds ?? []) structure(scen(sid), task(t.id));

  const decisions = toDecisions(inp);
  for (const d of decisions) {
    for (const sid of d.refs.scenarioIds) if (ids.has(scen(sid))) edges.push({ type: "affects", from: d.id, to: scen(sid), decisionId: d.id });
    for (const tid of d.refs.taskIds) if (ids.has(task(tid))) edges.push({ type: "affects", from: d.id, to: task(tid), decisionId: d.id });
  }

  const evidence: WhyEvidence[] = [];
  const addEv = (id: string, kind: WhyEvidence["kind"], scenarioId: string | undefined, relation: WhyEvidence["relation"], detail: Record<string, unknown>) => {
    if (!scenarioId || !ids.has(scen(scenarioId))) return;
    evidence.push({ id, kind, subjectId: scen(scenarioId), relation, detail });
    edges.push({ type: "evidence", from: id, to: scen(scenarioId), evidenceId: id });
  };
  for (const s of inp.scores) addEv(s.id, "score", s.scenarioId, "supports", { composite: s.composite, criteria: s.criteria, note: s.note });
  for (const r of inp.testRuns) addEv(r.id, "test-run", r.scenarioId, "supports", { failed: r.failed, issues: r.issues });
  // Skip verifications with no verdict — an unknown verdict is neither support nor refutation.
  for (const v of inp.verifications) {
    if (v.verdict === undefined) continue;
    addEv(v.id, "verification", v.scenarioId, v.verdict === "refuted" ? "refutes" : "supports", { verdict: v.verdict, summary: v.summary });
  }

  return { subjects, decisions, evidence, edges };
}
