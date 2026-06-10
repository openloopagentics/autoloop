import { RollupStrip } from "../components/RollupStrip";
import { LoopSnapshot } from "../components/LoopSnapshot";
import { TrendsStrip } from "../components/TrendsStrip";
import type { SelectableLoop } from "../loopView";
import type { TrendPoint } from "../trendView";
import type { Phase, Task, Scenario, Score, TestRun } from "../types";

export function DashboardTab({ loops, selected, status, phases, tasks, scenarios, scores, testRuns, trendPoints }: {
  loops: SelectableLoop[]; selected: SelectableLoop | undefined; status?: string;
  phases: Phase[]; tasks: Task[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[];
  trendPoints: TrendPoint[];
}) {
  return (
    <>
      <RollupStrip loops={loops} status={status} />
      <TrendsStrip points={trendPoints} />
      {selected && <LoopSnapshot loop={selected} phases={phases} tasks={tasks} scenarios={scenarios} scores={scores} testRuns={testRuns} />}
    </>
  );
}
