import type { WhyModel, WhyDecision, WhyEvidence, SubjectState, DecisionKind } from "./whyModel";

/** A short, human label per evidence kind — NOT a raw stringify of the detail
 *  (a test-run would otherwise render the literal "test-run"). */
function evidenceLabel(ev: WhyEvidence): string {
  const d = ev.detail;
  switch (ev.kind) {
    case "score": return d.composite != null ? `score ${String(d.composite)}` : "score";
    case "test-run": { const f = Number(d.failed ?? 0); return f > 0 ? `${f} failed` : "passed"; }
    case "verification": return d.verdict === "refuted" ? "refuted" : d.verdict === "confirmed" ? "confirmed" : "verification";
    case "commit": return typeof d.sha === "string" ? `commit ${d.sha.slice(0, 7)}` : "commit";
    default: return ev.kind;
  }
}

export type GraphNodeKind = "goal" | "scenario" | "task" | "bug" | "decision" | "evidence";
export interface GraphNode {
  id: string; kind: GraphNodeKind; label: string; state: SubjectState;
  whyChip?: string; loopId?: string; decisionKind?: DecisionKind;
}
export interface GraphEdge { id: string; from: string; to: string; kind: "structure" | "affects" | "evidence"; label?: string; }

export function buildWhyGraph(model: WhyModel, opts: { showReasoning: boolean }): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Structural subject nodes (always). SubjectKind includes "loop", which is not a graph
  // node kind (buildWhyModel never emits it today) — skip it so `kind` narrows safely.
  for (const s of model.subjects) {
    if (s.kind === "loop") continue;
    const kind: GraphNodeKind = s.kind;
    const topFail = s.explanation?.reasons.find((r) => !r.ok);
    nodes.push({
      id: s.id, kind, label: s.label,
      state: s.explanation?.state ?? "neutral", loopId: s.loopId,
      whyChip: s.kind === "scenario" && s.explanation?.state === "unmet" ? topFail?.text : undefined,
    });
  }
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Structure edges (always)
  for (const e of model.edges) if (e.type === "structure") edges.push({ id: `${e.from}->${e.to}`, from: e.from, to: e.to, kind: "structure" });

  if (!opts.showReasoning) {
    // Collapse each decision onto the incoming structure edge of the subject it affects.
    // Pick the most recent decision per target (decisions are id-ordered → max id wins).
    const byTarget = new Map<string, WhyDecision>();
    for (const d of model.decisions) {
      for (const sid of d.refs.scenarioIds.map((x) => `scenario:${x}`).concat(d.refs.taskIds.map((x) => `task:${x}`))) {
        if (!nodeIds.has(sid)) continue;
        const prev = byTarget.get(sid);
        if (!prev || d.id > prev.id) byTarget.set(sid, d);
      }
    }
    for (const [target, d] of byTarget) {
      const edge = edges.find((e) => e.to === target && e.kind === "structure");
      if (edge) {
        const count = model.decisions.filter((x) =>
          x.refs.scenarioIds.includes(target.replace(/^scenario:/, "")) || x.refs.taskIds.includes(target.replace(/^task:/, ""))).length;
        edge.label = count > 1 ? `${d.summary} (+${count - 1} more)` : d.summary;
      }
    }
    return { nodes, edges };
  }

  // Reasoning mode: add decision + evidence nodes and their edges.
  for (const d of model.decisions) nodes.push({ id: d.id, kind: "decision", label: d.summary, state: "neutral", loopId: d.loopId, decisionKind: d.kind });
  for (const ev of model.evidence) nodes.push({ id: ev.id, kind: "evidence", label: evidenceLabel(ev), state: "neutral" });
  const allIds = new Set(nodes.map((n) => n.id));
  for (const e of model.edges) {
    if (e.type === "affects" && allIds.has(e.from) && allIds.has(e.to)) edges.push({ id: `a:${e.from}->${e.to}`, from: e.from, to: e.to, kind: "affects" });
    if (e.type === "evidence" && allIds.has(e.from) && allIds.has(e.to)) edges.push({ id: `e:${e.from}->${e.to}`, from: e.from, to: e.to, kind: "evidence" });
  }
  return { nodes, edges };
}
