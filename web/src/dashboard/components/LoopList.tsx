import { usePhases, useScores, useTestRuns } from "../hooks";
import { phaseProgress, loopArgFor, type SelectableLoop } from "../loopView";
import { summarize } from "../scenarioState";
import { LoopRow } from "./LoopRow";
import type { Scenario } from "../types";

function LoopRowContainer({ teamId, slug, loop, scenarios, selected, onSelect }: {
  teamId: string; slug: string; loop: SelectableLoop; scenarios: Scenario[]; selected: boolean; onSelect: (id: string) => void;
}) {
  const arg = loopArgFor(loop);
  const phases = usePhases(teamId, slug, arg);
  const scores = useScores(teamId, slug, arg);
  const testRuns = useTestRuns(teamId, slug, arg);
  return (
    <LoopRow loop={loop} selected={selected}
      progress={phaseProgress(phases.data)}
      met={summarize(scenarios, scores.data, testRuns.data)}
      onSelect={onSelect} />
  );
}

export function LoopList({ teamId, slug, loops, scenarios, selectedId, onSelect }: {
  teamId: string; slug: string; loops: SelectableLoop[]; scenarios: Scenario[]; selectedId: string; onSelect: (id: string) => void;
}) {
  if (loops.length === 0) return <div className="empty">No loops yet.</div>;
  return (
    <div className="looplist">
      {loops.map((l) => (
        <LoopRowContainer key={l.id} teamId={teamId} slug={slug} loop={l} scenarios={scenarios} selected={l.id === selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}
