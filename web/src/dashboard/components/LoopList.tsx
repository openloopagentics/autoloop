import { Fragment, type ReactNode } from "react";
import { usePhases, useScores, useTestRuns } from "../hooks";
import { phaseProgress, loopArgFor, groupLoopRuns, type SelectableLoop } from "../loopView";
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

export function LoopList({ teamId, slug, loops, scenarios, selectedId, onSelect, detail }: {
  teamId: string; slug: string; loops: SelectableLoop[]; scenarios: Scenario[]; selectedId: string; onSelect: (id: string) => void;
  detail?: ReactNode; // rendered inline beneath the selected loop row
}) {
  if (loops.length === 0) return <div className="empty">No loops yet.</div>;
  return (
    <div className="looplist">
      {groupLoopRuns(loops).map((g) => (
        <section key={g.label} className="loopgroup">
          <h3 className="loopgroup-label">{g.label}</h3>
          {g.loops.map((l) => (
            <Fragment key={l.id}>
              <LoopRowContainer teamId={teamId} slug={slug} loop={l} scenarios={scenarios} selected={l.id === selectedId} onSelect={onSelect} />
              {l.id === selectedId && detail && <div className="loopdetail">{detail}</div>}
            </Fragment>
          ))}
        </section>
      ))}
    </div>
  );
}
