import { useEffect, useMemo, useState } from "react";
import { buildWhyModel, type BuildWhyModelInput } from "../whyModel";
import { whyModelAtTime, tsMillis } from "../whyModelAtTime";
import { buildWhyGraph } from "../whyGraph";
import { useDecisions } from "../hooks";
import { MapCanvas } from "../components/MapCanvas";
import { MapScrubber } from "../components/MapScrubber";
import { LoopSelector } from "../components/LoopSelector";
import { WhyPanel } from "../components/WhyPanel";
import { EmptyState } from "../components/EmptyState";
import type { SelectableLoop } from "../loopView";
import type { Bug, Goal, Idea, Revision, Scenario, Score, Task, TestRun, Verification, VisionChange } from "../types";

export interface MapTabProps {
  teamId: string; slug: string;
  loops: SelectableLoop[]; selectedId: string; onSelect: (id: string) => void;
  loopArg?: string;                          // scoped loop id (undefined for the synthetic "main" → project-direct path)
  goals: Goal[]; scenarios: Scenario[];
  scores: Score[]; testRuns: TestRun[];     // project-wide (all loops) — scenarios are project-level vision
  tasks: Task[]; bugs: Bug[];               // selected-loop scoped (same convention as the Loops tab)
  currentTaskId?: string | null;
  verifications?: Verification[];           // selected-loop scoped
  revisions?: Revision[];                   // selected-loop scoped — feed plan-change decisions
  visionChanges?: VisionChange[];           // project-wide — feed vision-change decisions
  ideas?: Idea[];                           // project-wide — seed a synthesized goal-pick
  projectCreatedAt?: unknown;               // replay range start
}

export function MapTab(props: MapTabProps) {
  const {
    teamId, slug, loops, selectedId, onSelect, loopArg,
    goals, scenarios, scores, testRuns, tasks, bugs, currentTaskId,
    verifications = [], revisions = [], visionChanges = [], ideas = [], projectCreatedAt,
  } = props;

  // loopArg (undefined for the synthetic "main") scopes decisions + the model's loopId the same
  // way ProjectDetail scopes revisions/tasks/bugs — selectedId is for the LoopSelector UI only.
  const decisions = useDecisions(teamId, slug, loopArg);

  const input = useMemo<BuildWhyModelInput>(() => ({
    loopId: loopArg,
    goals, scenarios, tasks, bugs, scores, testRuns, verifications,
    revisions, visionChanges, decisions: decisions.data, ideas, currentTaskId,
  }), [loopArg, goals, scenarios, tasks, bugs, scores, testRuns, verifications, revisions, visionChanges, decisions.data, ideas, currentTaskId]);

  const [showReasoning, setShowReasoning] = useState(false);
  const [scrubT, setScrubT] = useState<number | null>(null); // null = live
  const [playing, setPlaying] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const maxT = useMemo(() => Date.now(), []);          // replay range end, fixed at mount
  const minT = tsMillis(projectCreatedAt) ?? maxT - 1;

  // Play: ~10s sweep (100 ticks × 100ms); reaching max ⇒ back to live.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setScrubT((prev) => {
        const next = (prev ?? minT) + (maxT - minT) / 100;
        if (next >= maxT) { setPlaying(false); return null; }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, minT, maxT]);

  const liveModel = useMemo(() => buildWhyModel(input), [input]);
  const model = useMemo(() => (scrubT === null ? liveModel : whyModelAtTime(input, scrubT)), [liveModel, input, scrubT]);
  const liveGraph = useMemo(() => buildWhyGraph(liveModel, { showReasoning }), [liveModel, showReasoning]); // drives layout
  const graph = useMemo(() => buildWhyGraph(model, { showReasoning }), [model, showReasoning]);             // drives render

  // Clear a selection that no longer exists at the current cutoff (scrubbed before it appeared).
  useEffect(() => {
    if (selectedNodeId && !graph.nodes.some((n) => n.id === selectedNodeId)) setSelectedNodeId(null);
  }, [graph, selectedNodeId]);

  if (goals.length === 0) return <EmptyState message="No goals yet — the map appears once the vision has goals." />;

  return (
    <section className="maptab">
      <div className="maptab-head">
        <LoopSelector loops={loops} selectedId={selectedId} onChange={onSelect} />
        <button type="button" className={`btn btn-ghost btn-sm maptab-toggle${showReasoning ? " is-on" : ""}`}
          aria-pressed={showReasoning} onClick={() => setShowReasoning((v) => !v)}>
          {showReasoning ? "Hide reasoning" : "Show reasoning"}
        </button>
        <ul className="map-legend" aria-label="node states">
          <li><span className="map-legend-dot map-met" />met</li>
          <li><span className="map-legend-dot map-unmet" />unmet</li>
          <li><span className="map-legend-dot map-bugged" />bug</li>
          <li><span className="map-legend-dot map-active" />active</li>
        </ul>
      </div>
      <MapCanvas
        layoutNodes={liveGraph.nodes} layoutEdges={liveGraph.edges}
        nodes={graph.nodes} edges={graph.edges}
        onNodeClick={setSelectedNodeId} />
      <MapScrubber min={minT} max={maxT} value={scrubT} playing={playing}
        onChange={(v) => { setScrubT(v); if (v === null) setPlaying(false); }}
        onPlayPause={() => { setPlaying((p) => !p); if (!playing && scrubT === null) setScrubT(minT); }} />
      {selectedNodeId && <WhyPanel model={model} nodeId={selectedNodeId} onClose={() => setSelectedNodeId(null)} />}
    </section>
  );
}
