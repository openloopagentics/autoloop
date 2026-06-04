import type { SelectableLoop } from "../loopView";
import { loopIsRunning } from "../loopView";
import { StatusBadge } from "./StatusBadge";

export function RollupStrip({ loops, status }: { loops: SelectableLoop[]; status?: string }) {
  const running = loops.filter(loopIsRunning).length;
  return (
    <div className="rollup card">
      <div className="rollup-item"><span className="rollup-num tnum">{loops.length}</span><span className="rollup-label">loops</span></div>
      <div className="rollup-item"><span className="rollup-num tnum">{running}</span><span className="rollup-label">running</span></div>
      {status && <div className="rollup-item rollup-status"><StatusBadge status={status} /></div>}
    </div>
  );
}
