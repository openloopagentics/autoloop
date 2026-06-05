import type { ReactNode } from "react";
import { LoopList } from "../components/LoopList";
import { LoopDetail } from "../components/LoopDetail";
import type { SelectableLoop } from "../loopView";
import type { Phase, Task, Scenario, TestRun, Revision } from "../types";

export function LoopsTab({ teamId, slug, loops, scenarios, selectedId, selected, onSelect, phases, tasks, testRuns, revisions, renderLegacyPhase, renderTask }: {
  teamId: string; slug: string; loops: SelectableLoop[]; scenarios: Scenario[]; selectedId: string; selected: SelectableLoop | undefined;
  onSelect: (id: string) => void; phases: Phase[]; tasks: Task[]; testRuns: TestRun[]; revisions: Revision[];
  renderLegacyPhase: (p: Phase) => ReactNode; renderTask: (t: Task, isCurrent: boolean) => ReactNode;
}) {
  return (
    <LoopList teamId={teamId} slug={slug} loops={loops} scenarios={scenarios} selectedId={selectedId} onSelect={onSelect}
      detail={selected && <LoopDetail phases={phases} tasks={tasks} testRuns={testRuns} revisions={revisions}
        currentTaskId={selected.currentTaskId} renderLegacyPhase={renderLegacyPhase} renderTask={renderTask} />} />
  );
}
