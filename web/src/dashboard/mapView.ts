import { z } from "zod";
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

export const PRODUCT_MAP_MAX_BYTES = 100 * 1024;
const componentNode = z.object({
  id: z.string().regex(/^[a-z0-9._-]+$/),
  label: z.string().min(1),
  kind: z.string().optional(),
  scenarioIds: z.array(z.string()).optional(),
});
export const productMapSchema = z.object({
  nodes: z.array(componentNode),
  edges: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
});
export type ProductMap = z.infer<typeof productMapSchema>;

/** Parse + validate the agent-maintained product-map document. Never throws. */
function parseProductMap(content: string): { map: ProductMap } | { warning: string } {
  if (content.length > PRODUCT_MAP_MAX_BYTES) {
    return { warning: "product-map document exceeds 100KB — architecture layer not rendered" };
  }
  let raw: unknown;
  try { raw = JSON.parse(content); }
  catch { return { warning: "product-map document is not valid JSON — architecture layer not rendered" }; }
  const parsed = productMapSchema.safeParse(raw);
  if (!parsed.success) return { warning: "product-map document does not match the expected shape — architecture layer not rendered" };
  return { map: parsed.data };
}

/** Deterministic hue per loop so each loop's additions read as a growth ring (Phase 2). */
export function hueForLoop(loopId: string): number {
  let h = 0;
  for (let i = 0; i < loopId.length; i++) h = (h * 31 + loopId.charCodeAt(i)) % 360;
  return h;
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
    if (t.loopId) node.loopId = t.loopId;
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

  let warning: string | undefined;
  if (input.productMap !== undefined) {
    const parsed = parseProductMap(input.productMap);
    if ("warning" in parsed) {
      warning = parsed.warning;
    } else {
      const scnState = new Map(nodes.filter((n) => n.type === "scenario").map((n) => [n.id, n.state]));
      for (const c of parsed.map.nodes) {
        const states = (c.scenarioIds ?? [])
          .map((sid) => scnState.get(`s:${sid}`))
          .filter((s): s is MapNodeState => s !== undefined);
        // Worst-of-scenarios: any bugged → bugged, else any unmet → unmet, else met; none → neutral.
        const state: MapNodeState = states.length === 0 ? "neutral"
          : states.includes("bugged") ? "bugged"
          : states.includes("unmet") ? "unmet"
          : "met";
        nodes.push({ id: `c:${c.id}`, type: "component", label: c.label, state });
      }
      const allIds = new Set(nodes.map((n) => n.id));
      for (const c of parsed.map.nodes) {
        for (const sid of c.scenarioIds ?? []) if (allIds.has(`s:${sid}`)) edges.push({ from: `c:${c.id}`, to: `s:${sid}` });
      }
      for (const e of parsed.map.edges ?? []) {
        if (allIds.has(`c:${e.from}`) && allIds.has(`c:${e.to}`)) edges.push({ from: `c:${e.from}`, to: `c:${e.to}` });
      }
    }
  }
  return warning === undefined ? { nodes, edges } : { nodes, edges, warning };
}
