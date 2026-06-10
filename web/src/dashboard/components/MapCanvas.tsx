import { useMemo } from "react";
import { ReactFlow, Background, MiniMap, Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import type { MapEdge, MapNode } from "../mapView";

const NODE_W = 168;
const NODE_H = 44;

/** dagre LR layout: goals left → bugs right. Pure function of the derived graph. */
function layout(nodes: MapNode[], edges: MapEdge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 64 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { id: n.id, type: "map", position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 }, data: { ...n } };
  });
}

function MapNodeView({ data }: NodeProps) {
  const n = data as unknown as MapNode;
  return (
    <div className={`mapnode mapnode--${n.type} map-${n.state}${n.done ? " mapnode--done" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="mapnode-label">{n.label}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { map: MapNodeView };

export function MapCanvas({ nodes, edges, onNodeClick }: {
  nodes: MapNode[]; edges: MapEdge[]; onNodeClick?: (id: string) => void;
}) {
  const rfNodes = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const rfEdges = useMemo<Edge[]>(
    () => edges.map((e) => ({ id: `${e.from}->${e.to}`, source: e.from, target: e.to })), [edges]);
  return (
    <div className="mapwrap">
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView
        nodesDraggable={false} nodesConnectable={false}
        onNodeClick={(_, n) => onNodeClick?.(n.id)}>
        <Background />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
