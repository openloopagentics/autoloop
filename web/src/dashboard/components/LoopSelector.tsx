import type { SelectableLoop } from "../loopView";

function labelFor(l: SelectableLoop): string {
  return l.isMain ? "main (legacy)" : (l.name ?? l.goal ?? l.id);
}

export function LoopSelector({ loops, selectedId, onChange }: { loops: SelectableLoop[]; selectedId: string; onChange: (id: string) => void }) {
  if (loops.length <= 1) return null;
  return (
    <label className="loopsel">
      <span className="loopsel-label dim">Loop</span>
      <select value={selectedId} onChange={(e) => onChange(e.target.value)}>
        {loops.map((l) => (
          <option key={l.id} value={l.id}>{labelFor(l)}{l.status ? ` — ${l.status}` : ""}</option>
        ))}
      </select>
    </label>
  );
}
