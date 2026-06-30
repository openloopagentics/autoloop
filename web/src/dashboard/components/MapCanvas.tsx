import { useMemo } from "react";
import { ReactFlow, Background, MiniMap, Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import type { GraphNode, GraphEdge } from "../whyGraph";

const NODE_W = 190;
const NODE_H = 56; // taller: labels wrap to 2 lines + optional why-chip

/** dagre LR layout (goals left → bugs/evidence right) → positions keyed by node id. */
function layoutPositions(nodes: GraphNode[], edges: GraphEdge[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 64 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    if (p) pos.set(n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
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
