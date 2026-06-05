import { useState } from "react";
import { useLoops, useSessionLog } from "../hooks";
import type { Loop, SessionDoc, SessionEntry } from "../types";

function formatTime(ts: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function EntryRow({ entry }: { entry: SessionEntry }) {
  if (entry.kind === "user") {
    return (
      <div className="slog-entry slog-entry--user">
        <span className="slog-role dim">you</span>
        <span className="slog-text">{entry.text}</span>
      </div>
    );
  }
  if (entry.kind === "assistant") {
    return (
      <div className="slog-entry slog-entry--assistant">
        <span className="slog-role">claude</span>
        <span className="slog-text">{entry.text}</span>
      </div>
    );
  }
  return (
    <div className={`slog-entry slog-entry--tool${entry.ok ? "" : " slog-entry--tool-err"}`}>
      <span className="slog-tool-icon">{entry.ok ? "✓" : "✗"}</span>
      <span className="slog-tool-name">{entry.name}</span>
      <span className="slog-tool-summary dim">{entry.summary}</span>
    </div>
  );
}

function SessionBlock({ session, index, single }: { session: SessionDoc; index: number; single: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const start = formatTime(session.startedAt);
  const end = formatTime(session.endedAt);
  const visible = showAll ? session.entries : session.entries.slice(0, 50);
  const hidden = session.entries.length - 50;
  return (
    <div className="slog-session">
      {!single && (
        <div className="slog-session-header dim">
          Session {index + 1} · {start}{end && end !== start ? ` – ${end}` : ""}
        </div>
      )}
      {visible.map((e, i) => <EntryRow key={i} entry={e} />)}
      {!showAll && hidden > 0 && (
        <button type="button" className="slog-more dim" onClick={() => setShowAll(true)}>
          {hidden} more entries — show all
        </button>
      )}
    </div>
  );
}

/** Renders + (lazily) subscribes to a single loop's sessions. Only mounted when expanded. */
function LoopSessions({ teamId, slug, loopId }: { teamId: string; slug: string; loopId: string }) {
  const { data: sessions, loading, error } = useSessionLog(teamId, slug, loopId);
  if (loading) return <p className="dim slog-loop-body">Loading…</p>;
  if (error) return <p className="error-note slog-loop-body">{error}</p>;
  if (sessions.length === 0) return <p className="dim slog-loop-body">No session log for this loop yet.</p>;
  return (
    <div className="slog-loop-body">
      {sessions.map((s, i) => <SessionBlock key={s.sessionId} session={s} index={i} single={sessions.length === 1} />)}
    </div>
  );
}

function LoopRow({ teamId, slug, loop, defaultOpen }: { teamId: string; slug: string; loop: Loop; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`slog-loop${open ? " slog-loop--open" : ""}`}>
      <button type="button" className="slog-loop-head" onClick={() => setOpen((o) => !o)}>
        <span className="slog-loop-caret">{open ? "▾" : "▸"}</span>
        <span className="slog-loop-id">{loop.id}</span>
        {loop.goal && <span className="slog-loop-goal dim">{loop.goal}</span>}
        {loop.status && <span className={`slog-loop-status slog-loop-status--${loop.status}`}>{loop.status}</span>}
      </button>
      {open && <LoopSessions teamId={teamId} slug={slug} loopId={loop.id} />}
    </div>
  );
}

export function SessionLogTab({ teamId, slug }: { teamId: string; slug: string }) {
  const { data: loops, loading, error } = useLoops(teamId, slug);
  if (loading) return <p className="dim">Loading…</p>;
  if (error) return <p className="error-note">{error}</p>;
  if (loops.length === 0) return <p className="dim">No loops yet — the session log appears once a loop runs.</p>;
  // Newest loop first; auto-expand it so a running loop is visible without clicking.
  const ordered = [...loops].sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || b.id.localeCompare(a.id));
  return (
    <div className="slog-wrap">
      {ordered.map((loop, i) => (
        <LoopRow key={loop.id} teamId={teamId} slug={slug} loop={loop} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
