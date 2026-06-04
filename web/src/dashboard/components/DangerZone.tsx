import { useState } from "react";
import { ErrorNote } from "./ErrorNote";

/**
 * Destructive "delete this project" control. Requires typing the exact slug to confirm.
 * `onDelete` performs the delete (+ navigation) and may reject; the error is surfaced inline.
 * Render only for users allowed to delete (owner/manager) — the caller gates that.
 */
export function DangerZone({ slug, onDelete }: { slug: string; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
      setBusy(false);
    }
  }

  return (
    <section className="dangerzone">
      <div className="proj-section-head"><h2 className="proj-section-title dangerzone-title">Danger zone</h2></div>
      {!open ? (
        <button type="button" className="btn-danger" onClick={() => setOpen(true)}>Delete project…</button>
      ) : (
        <div className="dangerzone-confirm card">
          <p className="dim">
            This permanently deletes <strong>{slug}</strong> and all of its loops, phases, tasks,
            commits, scores, test runs, bugs, vision, and messages. This cannot be undone.
          </p>
          <label className="dangerzone-label">
            Type <code>{slug}</code> to confirm:
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </label>
          {error && <ErrorNote message={error} />}
          <div className="dangerzone-actions">
            <button type="button" className="btn" onClick={() => { setOpen(false); setTyped(""); setError(null); }} disabled={busy}>Cancel</button>
            <button type="button" className="btn-danger" onClick={() => void confirm()} disabled={typed !== slug || busy}>
              {busy ? "Deleting…" : "Delete this project"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
