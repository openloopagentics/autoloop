import type { ReactNode } from "react";
import type { Phase, Task, TestRun, Revision, Verification } from "../types";
import { PlanSection } from "./PlanSection";
import { TestRunsSection } from "./TestRunsSection";
import { RevisionTimeline } from "./RevisionTimeline";

export function LoopDetail({ phases, tasks, testRuns, revisions, currentTaskId, renderLegacyPhase, renderTask, verifications = [] }: {
  phases: Phase[]; tasks: Task[]; testRuns: TestRun[]; revisions: Revision[]; currentTaskId?: string | null;
  renderLegacyPhase: (phase: Phase) => ReactNode; renderTask: (task: Task, isCurrent: boolean) => ReactNode;
  verifications?: Verification[];
}) {
  return (
    <>
      <PlanSection phases={phases} tasks={tasks} currentTaskId={currentTaskId} renderLegacyPhase={renderLegacyPhase} renderTask={renderTask} />
      <TestRunsSection testRuns={testRuns} verifications={verifications} />
      <RevisionTimeline revisions={revisions} />
    </>
  );
}
