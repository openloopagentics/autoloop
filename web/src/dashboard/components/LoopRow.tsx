import type { SelectableLoop } from "../loopView";
import { StatusBadge } from "./StatusBadge";
import { relativeTime } from "../relativeTime";

export function LoopRow({ loop, selected, expanded, progress, met, onSelect }: {
  loop: SelectableLoop; selected: boolean; expanded?: boolean;
  progress: { done: number; total: number }; met: { met: number; total: number };
  onSelect: (id: string) => void;
}) {
  const started = relativeTime(loop.startedAt);
  return (
    <button type="button" className={`looprow card${selected ? " looprow--sel" : ""}`}
      aria-pressed={selected} aria-expanded={expanded ?? false} onClick={() => onSelect(loop.id)}>
      {!loop.isMain && typeof loop.order === "number" && (
        <span className="looprow-iter tnum" title={`iteration ${loop.order}`}>#{loop.order}</span>
      )}
      <span className="looprow-name">{loop.isMain ? "main (legacy)" : (loop.name ?? loop.goal ?? loop.id)}</span>
      {loop.status && <StatusBadge status={loop.status} />}
      {started && <span className="looprow-time tnum" title="started">{started}</span>}
      <span className="looprow-prog tnum">{progress.done}/{progress.total} phases</span>
      <span className="looprow-met tnum">{met.met}/{met.total} met</span>
    </button>
  );
}
