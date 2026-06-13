import { useState } from "react";
import { ErrorNote } from "./ErrorNote";
import { relativeTime } from "../relativeTime";
import type { VisionChange } from "../types";

/** One applied/rejected vision change: op + target, reason, time, status chip, Reject. */
export function VisionChangeCard({ change, targetTitle, onReject }: {
  change: VisionChange; targetTitle: string; onReject: (changeId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [rejectedLocal, setRejectedLocal] = useState(false); // chip flips on API success, before the snapshot lands
  const [error, setError] = useState<string | null>(null);
  const rejected = change.status === "rejected" || rejectedLocal;

  async function handleReject() {
    if (!window.confirm("Reject this change? The target reverts to its prior state.")) return;
    setBusy(true);
    setError(null);
    try { await onReject(change.id); setRejectedLocal(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to reject change"); }
    finally { setBusy(false); }
  }

  return (
    <div className={`vchange card${rejected ? " vchange--rejected" : ""}`}>
      <div className="vchange-head">
        <span className="vchange-op dim">{change.op === "upsert-goal" ? "goal" : "scenario"}</span>
        <span className="vchange-title">{targetTitle}</span>
        <span className={`vchange-status vchange-status--${rejected ? "rejected" : "applied"}`}>
          {rejected ? "Rejected" : "Applied"}
        </span>
        {!rejected && (
          <button className="btn btn-sm btn-danger" type="button" disabled={busy}
            aria-label={`reject change ${change.id}`} onClick={() => void handleReject()}>
            {busy ? "Rejecting…" : "Reject"}
          </button>
        )}
      </div>
      {change.reason && <p className="vchange-reason">{change.reason}</p>}
      <span className="vchange-time dim tnum">
        {relativeTime(change.createdAt)}
        {rejected && change.decidedAt != null ? ` · rejected ${relativeTime(change.decidedAt)}` : ""}
      </span>
      {error && <ErrorNote message={error} />}
    </div>
  );
}
