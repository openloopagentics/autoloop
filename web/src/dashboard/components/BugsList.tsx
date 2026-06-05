import type { Bug } from "../types";
import { BugItem } from "./BugItem";

export function BugsList({ bugs }: { bugs: Bug[] }) {
  if (bugs.length === 0) return <div className="empty">No bugs reported.</div>;
  const open = bugs.filter((b) => b.status !== "fixed");
  const fixed = bugs.filter((b) => b.status === "fixed");
  return (
    <section>
      <div className="proj-section-head"><h2 className="proj-section-title">Bugs</h2></div>
      <div className="buglist">{[...open, ...fixed].map((b) => <BugItem key={`${b.loopId ?? "main"}:${b.id}`} bug={b} />)}</div>
    </section>
  );
}
