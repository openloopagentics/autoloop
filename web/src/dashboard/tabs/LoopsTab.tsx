import { useState, type ReactNode } from "react";
import { LoopList } from "../components/LoopList";
import { LoopDetail } from "../components/LoopDetail";
import type { SelectableLoop } from "../loopView";
import type { Phase, Task, Scenario, TestRun, Revision, Verification } from "../types";

export function LoopsTab({ teamId, slug, loops, scenarios, selectedId, selected, onSelect, phases, tasks, testRuns, revisions, verifications, renderLegacyPhase, renderTask }: {
  teamId: string; slug: string; loops: SelectableLoop[]; scenarios: Scenario[]; selectedId: string; selected: SelectableLoop | undefined;
  onSelect: (id: string) => void; phases: Phase[]; tasks: Task[]; testRuns: TestRun[]; revisions: Revision[]; verifications: Verification[];
  renderLegacyPhase: (p: Phase) => ReactNode; renderTask: (t: Task, isCurrent: boolean) => ReactNode;
}) {
  // Clicking the already-expanded loop collapses its inline detail (and vice versa).
  // Collapse is local to this tab — the global loop selection other tabs use stays put.
  const [collapsed, setCollapsed] = useState(false);
  const handleSelect = (id: string) => {
    if (id === selectedId) setCollapsed((c) => !c);
    else { setCollapsed(false); onSelect(id); }
  };
  return (
    <LoopList teamId={teamId} slug={slug} loops={loops} scenarios={scenarios} selectedId={selectedId} onSelect={handleSelect}
      detail={!collapsed && selected && <LoopDetail phases={phases} tasks={tasks} testRuns={testRuns} revisions={revisions} verifications={verifications}
        currentTaskId={selected.currentTaskId} previewUrl={selected.previewUrl} renderLegacyPhase={renderLegacyPhase} renderTask={renderTask} />} />
  );
}
