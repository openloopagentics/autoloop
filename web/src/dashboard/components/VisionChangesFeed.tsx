import { VisionChangeCard } from "./VisionChangeCard";
import type { Goal, Scenario, VisionChange } from "../types";

/** Collapsible feed of loop-made vision changes, newest first (hook supplies desc ULID order). */
export function VisionChangesFeed({ changes, goals, scenarios, onReject }: {
  changes: VisionChange[]; goals: Goal[]; scenarios: Scenario[];
  onReject: (changeId: string) => Promise<void>;
}) {
  if (changes.length === 0) return null;
  const titleFor = (c: VisionChange) => {
    const pool: Array<{ id: string; title?: string }> = c.op === "upsert-goal" ? goals : scenarios;
    return pool.find((x) => x.id === c.targetId)?.title ?? c.targetId ?? "";
  };
  return (
    <section className="vchanges">
      <details className="vchanges-details">
        <summary className="proj-section-title">Changes ({changes.length})</summary>
        <div className="vchanges-list">
          {changes.map((c) => (
            <VisionChangeCard key={c.id} change={c} targetTitle={titleFor(c)} onReject={onReject} />
          ))}
        </div>
      </details>
    </section>
  );
}
