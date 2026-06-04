import { RollupStrip } from "../components/RollupStrip";
import { LoopSnapshot } from "../components/LoopSnapshot";
import type { SelectableLoop } from "../loopView";
import type { Phase, Task, Scenario, Score, TestRun } from "../types";

export function DashboardTab({ loops, selected, status, phases, tasks, scenarios, scores, testRuns }: {
  loops: SelectableLoop[]; selected: SelectableLoop | undefined; status?: string;
  phases: Phase[]; tasks: Task[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[];
}) {
  return (
    <>
      <RollupStrip loops={loops} status={status} />
      {selected && <LoopSnapshot loop={selected} phases={phases} tasks={tasks} scenarios={scenarios} scores={scores} testRuns={testRuns} />}
    </>
  );
}
