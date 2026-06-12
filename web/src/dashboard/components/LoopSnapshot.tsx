import type { Phase, Scenario, Score, TestRun, Task } from "../types";
import type { SelectableLoop } from "../loopView";
import { phaseProgress } from "../loopView";
import { summarize } from "../scenarioState";
import { StatusBadge } from "./StatusBadge";
import { PreviewLink } from "./PreviewLink";

export function LoopSnapshot({ loop, phases, tasks, scenarios, scores, testRuns }: {
  loop: SelectableLoop; phases: Phase[]; tasks: Task[]; scenarios: Scenario[]; scores: Score[]; testRuns: TestRun[];
}) {
  const prog = phaseProgress(phases);
  const met = summarize(scenarios, scores, testRuns);
  const currentTask = tasks.find((t) => t.id === loop.currentTaskId) ?? null;
  return (
    <section className="snapshot card">
      <div className="snapshot-head">
        <span className="snapshot-name">{loop.name ?? loop.goal ?? loop.id}</span>
        {loop.status && <StatusBadge status={loop.status} />}
        <PreviewLink url={loop.previewUrl} />
      </div>
      <div className="snapshot-metrics">
        <span className="snapshot-metric snapshot-phases tnum">{prog.done}/{prog.total}<span className="dim"> phases</span></span>
        <span className="snapshot-metric snapshot-met tnum">{met.met}/{met.total}<span className="dim"> scenarios met</span></span>
      </div>
      <div className="snapshot-current">
        {currentTask
          ? <><span className="sdot s-running is-live" aria-hidden="true" /><span>In progress: {currentTask.title ?? currentTask.id}</span></>
          : <span className="dim">No active task</span>}
      </div>
    </section>
  );
}
