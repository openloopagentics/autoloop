import type { SelectableLoop } from "../loopView";
import { StatusBadge } from "./StatusBadge";

export function LoopRow({ loop, selected, progress, met, onSelect }: {
  loop: SelectableLoop; selected: boolean;
  progress: { done: number; total: number }; met: { met: number; total: number };
  onSelect: (id: string) => void;
}) {
  return (
    <button type="button" className={`looprow card${selected ? " looprow--sel" : ""}`} aria-pressed={selected} onClick={() => onSelect(loop.id)}>
      <span className="looprow-name">{loop.isMain ? "main (legacy)" : (loop.name ?? loop.goal ?? loop.id)}</span>
      {loop.status && <StatusBadge status={loop.status} />}
      <span className="looprow-prog tnum">{progress.done}/{progress.total} phases</span>
      <span className="looprow-met tnum">{met.met}/{met.total} met</span>
    </button>
  );
}
