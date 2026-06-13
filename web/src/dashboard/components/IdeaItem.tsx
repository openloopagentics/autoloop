import { Markdown } from "./Markdown";
import type { Idea } from "../types";

export function IdeaItem({ idea, canMoveUp, canMoveDown, onPut, onMove }: {
  idea: Idea;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPut: (id: string, body: object) => Promise<void>;
  onMove: (id: string, dir: "up" | "down") => void;
}) {
  const status = idea.status ?? "proposed";
  const actionable = status === "proposed" || status === "accepted";
  return (
    <div className={`idearow card idea--${status}`}>
      <div className="idearow-head">
        <span className={`ideastatus ideastatus--${status}`}>{status}</span>
        <span className="idearow-title">{idea.title ?? idea.id}</span>
        {idea.by && <span className="idearow-by dim">{idea.by}</span>}
        {actionable && (
          <span className="idearow-actions">
            <button type="button" className="btn btn-sm" onClick={() => void onPut(idea.id, { status: "accepted" })}>Accept</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void onPut(idea.id, { status: "rejected" })}>Reject</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={!canMoveUp} aria-label="Move up" title="Move up" onClick={() => onMove(idea.id, "up")}>↑</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={!canMoveDown} aria-label="Move down" title="Move down" onClick={() => onMove(idea.id, "down")}>↓</button>
          </span>
        )}
      </div>
      {idea.rationale && (
        <details className="idearow-rationale">
          <summary className="dim">rationale</summary>
          <Markdown>{idea.rationale}</Markdown>
        </details>
      )}
      {(idea.originLoopId || idea.builtInLoopId) && (
        <div className="idearow-refs dim">
          {idea.originLoopId && <span>from {idea.originLoopId}</span>}
          {idea.builtInLoopId && <span>built in {idea.builtInLoopId}</span>}
        </div>
      )}
    </div>
  );
}
