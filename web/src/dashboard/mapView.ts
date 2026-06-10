import type { Bug, Goal, Scenario, Task } from "./types";
import type { ScenarioState } from "./scenarioState";
import { isTerminalStatus } from "./status";

export type MapNodeType = "goal" | "scenario" | "task" | "bug" | "component";
export type MapNodeState = "met" | "unmet" | "active" | "bugged" | "neutral";

export interface MapNode {
  id: string;            // namespaced: g:/s:/t:/b:/c: — prevents collisions across collections
  type: MapNodeType;
  label: string;
  state: MapNodeState;
  done?: boolean;        // terminal task → rendered dimmed
  loopId?: string;       // which loop added it (Phase 2 hue band)
}
export interface MapEdge { from: string; to: string; }
export interface MapGraph { nodes: MapNode[]; edges: MapEdge[]; warning?: string; }

export interface BuildMapInput {
  goals: Goal[];
  scenarios: Scenario[];
  scenarioStates: Record<string, Pick<ScenarioState, "state">>; // by scenario id (deriveScenarioState)
  tasks: Task[];                 // the selected loop's tasks
  currentTaskId?: string | null;
  openBugs: Bug[];               // open bugs only (status !== "fixed")
  productMap?: string;           // Phase 3: raw product-map document content (JSON string)
}

/** Derive the product map DAG. Pure; defensive against agent-written data
 *  (edges referencing missing nodes are dropped, never thrown on). */
export function buildMap(input: BuildMapInput): MapGraph {
  const { goals, scenarios, scenarioStates, tasks, currentTaskId, openBugs } = input;
  const nodes: MapNode[] = [];

  for (const g of goals) nodes.push({ id: `g:${g.id}`, type: "goal", label: g.title ?? g.id, state: "neutral" });

  const buggedScenarios = new Set(
    openBugs.filter((b) => b.severity === "high" && b.scenarioId).map((b) => b.scenarioId as string));
  for (const s of scenarios) {
    const base = scenarioStates[s.id]?.state ?? "unmet";
    nodes.push({ id: `s:${s.id}`, type: "scenario", label: s.title ?? s.id, state: buggedScenarios.has(s.id) ? "bugged" : base });
  }

  for (const t of tasks) {
    const node: MapNode = { id: `t:${t.id}`, type: "task", label: t.title ?? t.id, state: t.id === currentTaskId ? "active" : "neutral" };
    if (t.status && isTerminalStatus(t.status)) node.done = true;
    nodes.push(node);
  }

  for (const b of openBugs) {
    const node: MapNode = { id: `b:${b.id}`, type: "bug", label: b.title ?? b.id, state: "bugged" };
    if (b.loopId) node.loopId = b.loopId;
    nodes.push(node);
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: MapEdge[] = [];
  const push = (from: string, to: string) => { if (ids.has(from) && ids.has(to)) edges.push({ from, to }); };

  for (const s of scenarios) if (s.goalId) push(`g:${s.goalId}`, `s:${s.id}`);
  for (const t of tasks) for (const sid of t.scenarioIds ?? []) push(`s:${sid}`, `t:${t.id}`);
  for (const b of openBugs) {
    if (b.taskId && ids.has(`t:${b.taskId}`)) push(`t:${b.taskId}`, `b:${b.id}`);
    else if (b.scenarioId) push(`s:${b.scenarioId}`, `b:${b.id}`);
  }

  return { nodes, edges };
}
