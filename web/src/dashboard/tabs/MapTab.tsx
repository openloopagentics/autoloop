import { useEffect, useMemo, useState } from "react";
import { buildMap } from "../mapView";
import { mapAtTime, tsMillis, type LoopSlice } from "../mapTimeline";
import { deriveScenarioState, type ScenarioState } from "../scenarioState";
import { MapCanvas } from "../components/MapCanvas";
import { MapScrubber } from "../components/MapScrubber";
import { LoopSelector } from "../components/LoopSelector";
import { ScenarioCard } from "../components/ScenarioCard";
import { TaskItem } from "../components/TaskItem";
import { BugItem } from "../components/BugItem";
import { EmptyState } from "../components/EmptyState";
import type { SelectableLoop } from "../loopView";
import type { Bug, Goal, Scenario, Score, Task, TestRun, Verification } from "../types";

export interface MapTabProps {
  loops: SelectableLoop[]; selectedId: string; onSelect: (id: string) => void;
  goals: Goal[]; scenarios: Scenario[];
  scores: Score[]; testRuns: TestRun[];     // project-wide (all loops) — scenarios are project-level vision
  tasks: Task[]; bugs: Bug[];               // selected-loop scoped (same convention as the Loops tab)
  currentTaskId?: string | null;
  verifications?: Verification[];           // selected-loop scoped — feeds the ScenarioCard verification badge
  slices?: LoopSlice[];        // Phase 2: all-loops run data (useLoopTrend fetch layer)
  projectCreatedAt?: unknown;  // Phase 2: scrubber range start
}

interface PanelData { goals: Goal[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[]; tasks: Task[]; bugs: Bug[]; verifications: Verification[]; }

function MapPanelBody({ id, data }: { id: string; data: PanelData }) {
  const sep = id.indexOf(":");
  const ns = id.slice(0, sep);
  const key = id.slice(sep + 1);
  if (ns === "s") { const s = data.scenarios.find((x) => x.id === key); return s ? <ScenarioCard scenario={s} scores={data.scores} testRuns={data.testRuns} verifications={data.verifications} /> : null; }
  if (ns === "t") { const t = data.tasks.find((x) => x.id === key); return t ? <TaskItem task={t} commits={[]} /> : null; }
  if (ns === "b") { const b = data.bugs.find((x) => x.id === key); return b ? <BugItem bug={b} /> : null; }
  if (ns === "g") {
    const g = data.goals.find((x) => x.id === key);
    return g ? (<div className="map-goal"><h3>{g.title ?? g.id}</h3>{g.description && <p className="dim">{g.description}</p>}</div>) : null;
  }
  return null;
}

export function MapTab(props: MapTabProps) {
  const { loops, selectedId, onSelect, goals, scenarios, scores, testRuns, tasks, bugs, currentTaskId, verifications = [], slices, projectCreatedAt } = props;
  const [pickedNode, setPickedNode] = useState<string | null>(null);

  const openBugs = useMemo(() => bugs.filter((b) => (b.status ?? "open") === "open"), [bugs]);
  const scenarioStates = useMemo(() => {
    const m: Record<string, ScenarioState> = {};
    for (const s of scenarios) m[s.id] = deriveScenarioState(s, scores, testRuns);
    return m;
  }, [scenarios, scores, testRuns]);
  const graph = useMemo(
    () => buildMap({ goals, scenarios, scenarioStates, tasks, currentTaskId, openBugs }),
    [goals, scenarios, scenarioStates, tasks, currentTaskId, openBugs]);

  const [scrubT, setScrubT] = useState<number | null>(null); // null = live
  const [playing, setPlaying] = useState(false);
  const maxT = useMemo(() => Date.now(), []);                // replay range end, fixed at mount
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

  const replay = slices !== undefined && scrubT !== null;
  const shown = replay ? mapAtTime({ goals, scenarios, slices, cutoff: scrubT }) : graph;

  if (goals.length === 0) return <EmptyState message="No goals yet — the map appears once the vision has goals." />;

  return (
    <section className="maptab">
      <LoopSelector loops={loops} selectedId={selectedId} onChange={onSelect} />
      <MapCanvas nodes={shown.nodes} edges={shown.edges} onNodeClick={replay ? undefined : setPickedNode} />
      {slices !== undefined && (
        <MapScrubber min={minT} max={maxT} value={scrubT} playing={playing}
          onChange={(v) => { setScrubT(v); if (v === null) setPlaying(false); }}
          onPlayPause={() => { setPlaying((p) => !p); if (!playing && scrubT === null) setScrubT(minT); }} />
      )}
      {pickedNode && (
        <aside className="map-panel card" aria-label="map detail">
          <button type="button" className="map-panel-close" aria-label="close" onClick={() => setPickedNode(null)}>×</button>
          <MapPanelBody id={pickedNode} data={{ goals, scenarios, scores, testRuns, tasks, bugs: openBugs, verifications }} />
        </aside>
      )}
    </section>
  );
}
