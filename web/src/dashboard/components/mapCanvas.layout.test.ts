/**
 * Pure unit tests for the `layoutPositions` grid algorithm in MapCanvas.
 * Tests layout invariants only — no React, no DOM.
 */
import { describe, it, expect } from "vitest";
import { layoutPositions, NODE_W, NODE_H } from "./MapCanvas";
import type { GraphNode, GraphEdge } from "../whyGraph";

// ─── Fixture: 1 goal + 7 scenarios + 2 tasks ──────────────────────────────────
// Enough scenarios to force ≥2 rows and ≥2 columns (with SCEN_COLS=3: 3 cols, 3 rows).

function makeNode(id: string, kind: GraphNode["kind"]): GraphNode {
  return { id, kind, label: id, state: "neutral" };
}

function makeEdge(from: string, to: string, kind: GraphEdge["kind"] = "structure"): GraphEdge {
  return { id: `${from}->${to}`, from, to, kind };
}

const goalId = "goal:g1";
const scenIds = ["scenario:s1", "scenario:s2", "scenario:s3", "scenario:s4", "scenario:s5", "scenario:s6", "scenario:s7"];
const taskIds = ["task:t1", "task:t2"];

const fixtureNodes: GraphNode[] = [
  makeNode(goalId, "goal"),
  ...scenIds.map((id) => makeNode(id, "scenario")),
  makeNode(taskIds[0], "task"),
  makeNode(taskIds[1], "task"),
];

const fixtureEdges: GraphEdge[] = [
  // goal → every scenario
  ...scenIds.map((sid) => makeEdge(goalId, sid)),
  // scenario:s1 → task:t1, scenario:s2 → task:t2
  makeEdge("scenario:s1", taskIds[0]),
  makeEdge("scenario:s2", taskIds[1]),
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("layoutPositions — grid algorithm invariants", () => {
  it("every node gets a position", () => {
    const pos = layoutPositions(fixtureNodes, fixtureEdges);
    for (const n of fixtureNodes) {
      expect(pos.has(n.id), `missing position for ${n.id}`).toBe(true);
    }
  });

  it("no two nodes overlap (NODE_W × NODE_H bounding boxes do not intersect)", () => {
    const pos = layoutPositions(fixtureNodes, fixtureEdges);
    const entries = fixtureNodes.map((n) => ({ id: n.id, ...pos.get(n.id)! }));
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        const overlapX = a.x < b.x + NODE_W && a.x + NODE_W > b.x;
        const overlapY = a.y < b.y + NODE_H && a.y + NODE_H > b.y;
        expect(overlapX && overlapY, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("scenarios span multiple columns (≥2 distinct x values)", () => {
    const pos = layoutPositions(fixtureNodes, fixtureEdges);
    const scenX = new Set(scenIds.map((id) => pos.get(id)!.x));
    expect(scenX.size).toBeGreaterThanOrEqual(2);
  });

  it("scenarios span multiple rows (≥2 distinct y values)", () => {
    const pos = layoutPositions(fixtureNodes, fixtureEdges);
    const scenY = new Set(scenIds.map((id) => pos.get(id)!.y));
    expect(scenY.size).toBeGreaterThanOrEqual(2);
  });

  it("goal is to the left of all its scenarios (goal.x < scenario.x)", () => {
    const pos = layoutPositions(fixtureNodes, fixtureEdges);
    const gx = pos.get(goalId)!.x;
    for (const sid of scenIds) {
      expect(gx, `goal.x should be < ${sid}.x`).toBeLessThan(pos.get(sid)!.x);
    }
  });

  it("is deterministic — same input always produces same output", () => {
    const pos1 = layoutPositions(fixtureNodes, fixtureEdges);
    const pos2 = layoutPositions(fixtureNodes, fixtureEdges);
    for (const n of fixtureNodes) {
      expect(pos2.get(n.id)).toEqual(pos1.get(n.id));
    }
  });

  it("with SCEN_COLS=3 and 7 scenarios, there are exactly 3 distinct x columns among scenarios", () => {
    const pos = layoutPositions(fixtureNodes, fixtureEdges);
    const scenX = new Set(scenIds.map((id) => pos.get(id)!.x));
    expect(scenX.size).toBe(3);
  });

  it("with 7 scenarios in 3 columns, there are 3 distinct rows (rows 0,1,2)", () => {
    const pos = layoutPositions(fixtureNodes, fixtureEdges);
    const scenY = new Set(scenIds.map((id) => pos.get(id)!.y));
    expect(scenY.size).toBe(3); // ceil(7/3) = 3 rows
  });
});

describe("layoutPositions — orphan and extra nodes", () => {
  it("orphan scenarios (no goal) still get positions", () => {
    const nodes: GraphNode[] = [
      makeNode("scenario:orphan1", "scenario"),
      makeNode("scenario:orphan2", "scenario"),
    ];
    const pos = layoutPositions(nodes, []);
    expect(pos.has("scenario:orphan1")).toBe(true);
    expect(pos.has("scenario:orphan2")).toBe(true);
  });

  it("orphan scenarios with no goal land to the right of x=0 (scenario tier)", () => {
    const nodes: GraphNode[] = [makeNode("scenario:orphan", "scenario")];
    const pos = layoutPositions(nodes, []);
    expect(pos.get("scenario:orphan")!.x).toBeGreaterThan(0);
  });

  it("fully disconnected nodes (no edges at all) all receive a position", () => {
    const nodes: GraphNode[] = [
      makeNode("goal:g1", "goal"),
      makeNode("scenario:s1", "scenario"),
      makeNode("task:t99", "task"),
    ];
    const pos = layoutPositions(nodes, []);
    expect(pos.size).toBe(3);
  });

  it("reasoning nodes (decision, evidence) connected to a scenario land in a column right of tasks", () => {
    const nodes: GraphNode[] = [
      makeNode("goal:gA", "goal"),
      makeNode("scenario:sA", "scenario"),
      makeNode("decision:dA", "decision"),
    ];
    const edges: GraphEdge[] = [
      makeEdge("goal:gA", "scenario:sA"),
      makeEdge("decision:dA", "scenario:sA", "affects"),
    ];
    const pos = layoutPositions(nodes, edges);
    // Decision should be to the right of the scenario.
    expect(pos.get("decision:dA")!.x).toBeGreaterThan(pos.get("scenario:sA")!.x);
  });
});

describe("layoutPositions — multiple goals", () => {
  it("two goals produce vertically separated bands (goals have different y)", () => {
    const nodes: GraphNode[] = [
      makeNode("goal:g1", "goal"),
      makeNode("goal:g2", "goal"),
      makeNode("scenario:s1", "scenario"),
      makeNode("scenario:s2", "scenario"),
    ];
    const edges: GraphEdge[] = [
      makeEdge("goal:g1", "scenario:s1"),
      makeEdge("goal:g2", "scenario:s2"),
    ];
    const pos = layoutPositions(nodes, edges);
    expect(pos.get("goal:g1")!.y).not.toBe(pos.get("goal:g2")!.y);
    expect(pos.get("scenario:s1")!.y).not.toBe(pos.get("scenario:s2")!.y);
  });
});
