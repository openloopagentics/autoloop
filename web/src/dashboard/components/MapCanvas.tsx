import { useMemo } from "react";
import { ReactFlow, Background, MiniMap, Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphNode, GraphEdge } from "../whyGraph";

export const NODE_W = 190;
export const NODE_H = 56; // taller: labels wrap to 2 lines + optional why-chip

// Layout constants — tune here if visual density changes.
const SCEN_COLS = 3;   // max scenario columns per goal row
const GAP_X = 64;      // horizontal gap between tier columns
const CELL_GAP_Y = 16; // vertical gap between rows within a grid
const BAND_GAP = 48;   // vertical gap between goal bands

// Derived sizes
const CELL_W = NODE_W + GAP_X;   // horizontal stride per grid column
const CELL_H = NODE_H + CELL_GAP_Y; // vertical stride per grid row

// Fixed x positions (top-left of node)
const GOAL_X = 0;
const SCEN_X_BASE = NODE_W + GAP_X;  // left edge of first scenario column
const sceneColX = (col: number) => SCEN_X_BASE + col * CELL_W;
const TASK_X = SCEN_X_BASE + SCEN_COLS * CELL_W;
const EXTRA_X = TASK_X + NODE_W + GAP_X;

/**
 * Per-goal grid layout: goals in a left column; each goal's scenarios wrap into
 * up to SCEN_COLS columns; tasks, bugs, decisions, and evidence go in further-right
 * tiers within each goal's band. Pure, deterministic, no external deps.
 */
export function layoutPositions(nodes: GraphNode[], edges: GraphEdge[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const placed = new Set<string>();

  // Index nodes by id for O(1) kind lookup.
  const nodeById = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));

  // Build structure relations (goal→scenario, scenario→task) from "structure" edges.
  const scenariosOfGoal = new Map<string, string[]>();
  const tasksOfScenario = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "structure") continue;
    const fromKind = nodeById.get(e.from)?.kind;
    const toKind = nodeById.get(e.to)?.kind;
    if (fromKind === "goal" && toKind === "scenario") {
      if (!scenariosOfGoal.has(e.from)) scenariosOfGoal.set(e.from, []);
      scenariosOfGoal.get(e.from)!.push(e.to);
    } else if (fromKind === "scenario" && toKind === "task") {
      if (!tasksOfScenario.has(e.from)) tasksOfScenario.set(e.from, []);
      tasksOfScenario.get(e.from)!.push(e.to);
    }
  }

  // Process goals in node-array order.
  const goalNodes = nodes.filter((n) => n.kind === "goal");
  let bandTopY = 0;

  for (const goal of goalNodes) {
    // Scenarios for this goal, preserving node-array order.
    const rawScenIds = scenariosOfGoal.get(goal.id) ?? [];
    const orderedScenIds = nodes.filter((n) => rawScenIds.includes(n.id)).map((n) => n.id);

    // Collect tasks for this band (across all scenarios, in scenario order).
    const bandTaskIds: string[] = [];
    for (const scenId of orderedScenIds) {
      const rawTaskIds = tasksOfScenario.get(scenId) ?? [];
      for (const t of nodes.filter((n) => rawTaskIds.includes(n.id)).map((n) => n.id)) {
        if (!bandTaskIds.includes(t)) bandTaskIds.push(t);
      }
    }

    // Band node set used to find "extra" nodes (bugs, decisions, evidence) that connect here.
    const bandNodeIds = new Set([goal.id, ...orderedScenIds, ...bandTaskIds]);

    const extraIds: string[] = [];
    for (const n of nodes) {
      if (placed.has(n.id) || bandNodeIds.has(n.id)) continue;
      if (n.kind === "bug" || n.kind === "decision" || n.kind === "evidence") {
        const connects = edges.some(
          (e) => (e.from === n.id && bandNodeIds.has(e.to)) || (e.to === n.id && bandNodeIds.has(e.from)),
        );
        if (connects) extraIds.push(n.id);
      }
    }

    // Scenario grid dimensions.
    const scenRows = Math.ceil(Math.max(orderedScenIds.length, 1) / SCEN_COLS);
    const scenBandH = scenRows * CELL_H - CELL_GAP_Y;
    const taskBandH = bandTaskIds.length > 0 ? bandTaskIds.length * CELL_H - CELL_GAP_Y : 0;
    const extraBandH = extraIds.length > 0 ? extraIds.length * CELL_H - CELL_GAP_Y : 0;
    const bandHeight = Math.max(scenBandH, taskBandH, extraBandH, NODE_H);

    // Goal: vertically centered on the scenario grid.
    pos.set(goal.id, { x: GOAL_X, y: bandTopY + (scenBandH - NODE_H) / 2 });
    placed.add(goal.id);

    // Scenarios: grid layout.
    for (let i = 0; i < orderedScenIds.length; i++) {
      const col = i % SCEN_COLS;
      const row = Math.floor(i / SCEN_COLS);
      pos.set(orderedScenIds[i], { x: sceneColX(col), y: bandTopY + row * CELL_H });
      placed.add(orderedScenIds[i]);
    }

    // Tasks: single column stacked from band top.
    for (let i = 0; i < bandTaskIds.length; i++) {
      pos.set(bandTaskIds[i], { x: TASK_X, y: bandTopY + i * CELL_H });
      placed.add(bandTaskIds[i]);
    }

    // Extra (bugs, decisions, evidence): single column stacked from band top.
    for (let i = 0; i < extraIds.length; i++) {
      pos.set(extraIds[i], { x: EXTRA_X, y: bandTopY + i * CELL_H });
      placed.add(extraIds[i]);
    }

    bandTopY += bandHeight + BAND_GAP;
  }

  // Orphan scenarios (not connected to any goal): own grid band at bottom.
  const orphanScens = nodes.filter((n) => n.kind === "scenario" && !placed.has(n.id));
  if (orphanScens.length > 0) {
    for (let i = 0; i < orphanScens.length; i++) {
      const col = i % SCEN_COLS;
      const row = Math.floor(i / SCEN_COLS);
      pos.set(orphanScens[i].id, { x: sceneColX(col), y: bandTopY + row * CELL_H });
      placed.add(orphanScens[i].id);
    }
    const rows = Math.ceil(orphanScens.length / SCEN_COLS);
    bandTopY += (rows * CELL_H - CELL_GAP_Y) + BAND_GAP;
  }

  // Any remaining unplaced nodes: stack at the far-right column.
  let remainingY = bandTopY;
  for (const n of nodes) {
    if (!placed.has(n.id)) {
      pos.set(n.id, { x: EXTRA_X, y: remainingY });
      placed.add(n.id);
      remainingY += CELL_H;
    }
  }

  return pos;
}

function MapNodeView({ data }: NodeProps) {
  const n = data as unknown as GraphNode;
  return (
    <div className={`mapnode mapnode--${n.kind} map-${n.state}`} title={n.whyChip ? `${n.label}\n${n.whyChip}` : n.label}>
      <Handle type="target" position={Position.Left} />
      <span className="mapnode-head">
        <span className="mapnode-dot" aria-hidden="true" />
        <span className="mapnode-label">{n.label}</span>
      </span>
      {n.kind === "scenario" && n.whyChip && <span className="mapnode-why">{n.whyChip}</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { map: MapNodeView };

/**
 * Renders the explanation graph. `layoutNodes`/`layoutEdges` are the LIVE (full) graph used
 * purely to compute positions; `nodes`/`edges` are what actually render (a subset while
 * scrubbing). Positions are cached off the live graph so scrubbing never moves a node —
 * any rendered id missing from the cache (rare) falls back to a fresh layout.
 */
export function MapCanvas({ layoutNodes, layoutEdges, nodes, edges, onNodeClick }: {
  layoutNodes: GraphNode[]; layoutEdges: GraphEdge[];
  nodes: GraphNode[]; edges: GraphEdge[];
  onNodeClick?: (id: string) => void;
}) {
  // Memoized off the live graph's identity. MapTab memoizes the live graph, so this only
  // recomputes on a data change or a "show reasoning" toggle — never on a scrub.
  const cached = useMemo(() => layoutPositions(layoutNodes, layoutEdges), [layoutNodes, layoutEdges]);

  const rfNodes = useMemo<Node[]>(() => {
    const fallback = nodes.some((n) => !cached.has(n.id)) ? layoutPositions(nodes, edges) : null;
    return nodes.map((n) => ({
      id: n.id, type: "map",
      position: cached.get(n.id) ?? fallback?.get(n.id) ?? { x: 0, y: 0 },
      data: { ...n },
    }));
  }, [nodes, edges, cached]);

  const rfEdges = useMemo<Edge[]>(
    () => edges.map((e) => ({ id: e.id, source: e.from, target: e.to, type: "smoothstep", label: e.label, className: `mapedge mapedge--${e.kind}` })),
    [edges]);

  return (
    <div className="mapwrap">
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView
        fitViewOptions={{ maxZoom: 1 }} minZoom={0.2}
        nodesDraggable={false} nodesConnectable={false}
        onNodeClick={(_, n) => onNodeClick?.(n.id)}>
        <Background />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
