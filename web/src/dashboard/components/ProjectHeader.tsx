import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import type { Project } from "../types";

/** Restart is offered whenever the loop isn't verifiably alive — i.e. the EFFECTIVE
 *  status (loop-derived, zombie-aware) is anything but "running". */
export function canRestart(effectiveStatus: string | undefined): boolean {
  return effectiveStatus !== "running";
}

export function ProjectHeader({ project, status, onRestart }: {
  project: Project; status?: string;
  onRestart?: () => Promise<void>;   // "Restart loop" → POST /wake; the host wake job picks it up ≤5 min
}) {
  const shown = status ?? project.status;
  const requested = !!project.wakeRequestedAt;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function restart() {
    if (!onRestart) return;
    setBusy(true); setError(null);
    try { await onRestart(); }
    catch (e) { setError(e instanceof Error ? e.message : "Restart failed"); }
    finally { setBusy(false); }
  }
  return (
    <header className="proj-head">
      <div className="proj-head-top">
        <div>
          <h1 className="proj-title serif">{project.title ?? project.slug}</h1>
          <div className="proj-meta">
            <code className="chip">{project.slug}</code>
          </div>
        </div>
        <div className="proj-head-right">
          {onRestart && canRestart(shown) && (
            requested
              ? <span className="chip restart-pending" title="The host wake job polls every ~5 minutes">restart requested</span>
              : <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void restart()}>
                  {busy ? "Requesting…" : "Restart loop"}
                </button>
          )}
          {shown && <StatusBadge status={shown} />}
        </div>
      </div>
      {error && <p className="team-filter-note dim" role="alert">{error}</p>}

      {project.design?.format === "url" ? (
        <a href={project.design.content} target="_blank" rel="noopener" className="doc-link card">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
          <span className="doc-link-label">Design doc</span>
          <span className="doc-link-url mono">{project.design.content}</span>
        </a>
      ) : project.design ? (
        <pre className="doc-pre mono">{project.design.content}</pre>
      ) : null}
    </header>
  );
}
